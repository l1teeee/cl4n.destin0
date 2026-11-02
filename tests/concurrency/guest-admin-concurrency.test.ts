import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GuestFields } from "@/application/guests/guest-admin-repository";
import {
  acceptRequest,
  addRequest,
  cancelRequest,
  moveEntry,
  promoteEntry,
  rejectRequest,
  removeEntry,
  updateRequest,
  verifyPayment,
} from "@/application/guests/guest-admin-use-cases";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import { resetTestDatabase } from "../helpers/test-db";
import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";

interface InsertedReservation {
  id: string;
  fields: GuestFields;
}

interface InsertedWaitlistEntry {
  id: string;
  fields: GuestFields;
}

let pool: Pool;
let repository: PostgresGuestAdminRepository;
let submitReservation: ReturnType<typeof createSubmitReservation>;
let adminId: string;
let sequence = 0;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  pool = database.pool;
  repository = new PostgresGuestAdminRepository(pool);
  submitReservation = createSubmitReservation({
    repository: new PostgresReservationAllocationRepository(pool),
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
    generateLinkCode,
  });
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('guest-concurrency@example.com', 'guest-concurrency@example.com', 'hash',
             'Guest Concurrency')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

function fields(name: string, partySize: 1 | 2 = 1): GuestFields {
  sequence += 1;
  const handle = `${name.toLowerCase().replaceAll(/[^a-z0-9]/g, "")}.${sequence}`;
  return {
    partySize,
    guest1Name: name,
    guest1Instagram: handle,
    guest2Name: partySize === 2 ? `${name} Dos` : null,
    guest2Instagram: partySize === 2 ? `${handle}.dos` : null,
    hasAllergies: false,
    allergies: null,
    notes: null,
  };
}

async function insertReservation(
  eventId: string,
  name: string,
  stage: "IN_REVIEW" | "ON_LIST" | "PAID" = "IN_REVIEW",
  partySize: 1 | 2 = 1,
): Promise<InsertedReservation> {
  const guestFields = fields(name, partySize);
  const number = await pool.query<{ last_reservation_number: number }>(
    `UPDATE events
        SET reserved_seats = reserved_seats + $2,
            last_reservation_number = last_reservation_number + 1
      WHERE id = $1
      RETURNING last_reservation_number`,
    [eventId, partySize],
  );
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, stage, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, party_size, terms_accepted_at,
       link_code, idempotency_key, submitted_at, accepted_at, on_list_at, paid_at
     )
     VALUES ($1, $2, 'CONFIRMED', $3, $4, $5, $6, $7, $8, now(), $9, $10, now(), now(),
             CASE WHEN $3 IN ('ON_LIST', 'PAID') THEN now() END,
             CASE WHEN $3 = 'PAID' THEN now() END)
     RETURNING id`,
    [
      eventId,
      number.rows[0]!.last_reservation_number,
      stage,
      guestFields.guest1Name,
      guestFields.guest1Instagram,
      guestFields.guest2Name,
      guestFields.guest2Instagram,
      partySize,
      generateLinkCode(),
      randomUUID(),
    ],
  );
  return { id: inserted.rows[0]!.id, fields: guestFields };
}

async function insertWaitlistEntry(
  eventId: string,
  name: string,
  partySize: 1 | 2 = 1,
): Promise<InsertedWaitlistEntry> {
  const guestFields = fields(name, partySize);
  const number = await pool.query<{ last_waitlist_number: number }>(
    `UPDATE events
        SET waitlisted_count = waitlisted_count + 1,
            last_waitlist_number = last_waitlist_number + 1
      WHERE id = $1
      RETURNING last_waitlist_number`,
    [eventId],
  );
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, party_size, terms_accepted_at,
       link_code, idempotency_key, submitted_at
     )
     VALUES ($1, $2, 'WAITING', $3, $4, $5, $6, $7, now(), $8, $9, now())
     RETURNING id`,
    [
      eventId,
      number.rows[0]!.last_waitlist_number,
      guestFields.guest1Name,
      guestFields.guest1Instagram,
      guestFields.guest2Name,
      guestFields.guest2Instagram,
      partySize,
      generateLinkCode(),
      randomUUID(),
    ],
  );
  return { id: inserted.rows[0]!.id, fields: guestFields };
}

async function race<const Operations extends readonly (() => Promise<unknown>)[]>(
  operations: Operations,
): Promise<{ [Index in keyof Operations]: Awaited<ReturnType<Operations[Index]>> }> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = operations.map(async (operation) => {
    await barrier;
    return operation();
  });
  release();
  return Promise.all(pending) as Promise<{
    [Index in keyof Operations]: Awaited<ReturnType<Operations[Index]>>;
  }>;
}

async function waitForEventLockWaiters(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await pool.query<{ waiting: number }>(
      `SELECT COUNT(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND (
            query ILIKE '%FOR UPDATE OF e%'
            OR query ILIKE '%FROM events%FOR UPDATE%'
            OR query ILIKE 'UPDATE events%'
          )`,
    );
    if (result.rows[0]!.waiting === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected exactly ${expected} operations waiting on the event lock`);
}

async function fireBehindHeldEventLock<
  const Operations extends readonly (() => Promise<unknown>)[],
>(
  eventId: string,
  operations: Operations,
): Promise<{ [Index in keyof Operations]: Awaited<ReturnType<Operations[Index]>> }> {
  const holder = await pool.connect();
  let committed = false;
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
    const pending: Promise<unknown>[] = [];
    for (const [index, operation] of operations.entries()) {
      pending.push(operation());
      await waitForEventLockWaiters(index + 1);
    }
    await holder.query("COMMIT");
    committed = true;
    return Promise.all(pending) as Promise<{
      [Index in keyof Operations]: Awaited<ReturnType<Operations[Index]>>;
    }>;
  } finally {
    holder.release(!committed);
  }
}

async function assertInvariants(eventId: string): Promise<void> {
  const state = await pool.query<{
    capacity: number;
    reserved_seats: number;
    confirmed_seats: number;
    waitlisted_count: number;
    waiting_rows: number;
  }>(
    `SELECT e.capacity,
            e.reserved_seats,
            COALESCE((SELECT SUM(party_size)::int
                        FROM reservations
                       WHERE event_id = e.id AND status = 'CONFIRMED'), 0) AS confirmed_seats,
            e.waitlisted_count,
            (SELECT COUNT(*)::int
               FROM waitlist_entries
              WHERE event_id = e.id AND status = 'WAITING') AS waiting_rows
       FROM events e
      WHERE e.id = $1`,
    [eventId],
  );
  const row = state.rows[0]!;
  expect(row.reserved_seats).toBe(row.confirmed_seats);
  expect(row.reserved_seats).toBeLessThanOrEqual(row.capacity);
  expect(row.waitlisted_count).toBe(row.waiting_rows);

  const numbers = await pool.query<{ waitlist_number: number }>(
    `SELECT waitlist_number
       FROM waitlist_entries
      WHERE event_id = $1`,
    [eventId],
  );
  const values = numbers.rows.map((entry) => entry.waitlist_number);
  expect(new Set(values).size).toBe(values.length);

  const invalidPromotions = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM waitlist_entries w
       LEFT JOIN reservations r ON r.id = w.promoted_reservation_id
      WHERE w.event_id = $1
        AND w.status = 'PROMOTED'
        AND (r.id IS NULL OR r.status <> 'CONFIRMED')`,
    [eventId],
  );
  expect(invalidPromotions.rows[0]!.count).toBe(0);
}

// Keeps the code reserved inside an open transaction, so the pre-insert check cannot see it
// but the unique index still makes a competing insert wait for this transaction.
async function holdUncommittedLinkCode(
  table: "reservations" | "waitlist_entries",
  eventId: string,
  linkCode: string,
): Promise<PoolClient> {
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    const holderFields = fields("Titular Codigo");
    if (table === "reservations") {
      await holder.query(
        `INSERT INTO reservations (
           event_id, reservation_number, status, stage, full_name, instagram_handle,
           party_size, terms_accepted_at, link_code, idempotency_key, submitted_at, accepted_at
         )
         VALUES ($1, 1, 'CONFIRMED', 'IN_REVIEW', $2, $3, 1, now(), $4, $5, now(), now())`,
        [eventId, holderFields.guest1Name, holderFields.guest1Instagram, linkCode, randomUUID()],
      );
    } else {
      await holder.query(
        `INSERT INTO waitlist_entries (
           event_id, waitlist_number, status, full_name, instagram_handle,
           party_size, terms_accepted_at, link_code, idempotency_key, submitted_at
         )
         VALUES ($1, 1, 'WAITING', $2, $3, 1, now(), $4, $5, now())`,
        [eventId, holderFields.guest1Name, holderFields.guest1Instagram, linkCode, randomUUID()],
      );
    }
    return holder;
  } catch (error) {
    holder.release(true);
    throw error;
  }
}

async function waitForBlockedInsert(table: "reservations" | "waitlist_entries"): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const result = await pool.query<{ waiting: number }>(
      `SELECT COUNT(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      [`INSERT INTO ${table} (%`],
    );
    if (result.rows[0]!.waiting === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected the ${table} insert to wait for the transaction holding its link code`);
}

describe("guest admin concurrency", () => {
  it.each(["IN_REVIEW", "ON_LIST", "PAID"] as const)(
    "allows only one of two admins releasing %s reservations to choose the same entry",
    async (stage) => {
      const event = await insertTestEvent(pool, {
        capacity: 2,
        maxPartySize: 1,
        waitlistCapacity: 5,
      });
      const first = await insertReservation(event.id, "Primera Elegida", stage);
      const second = await insertReservation(event.id, "Segunda Elegida", stage);
      const head = await insertWaitlistEntry(event.id, "Cabeza Esperando Elección");
      const chosen = await insertWaitlistEntry(event.id, "Elección Compartida");
      const secondAdmin = await pool.query<{ id: string }>(
        `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
         VALUES ($1, $1, 'hash', 'Segundo Admin') RETURNING id`,
        [`${randomUUID()}@example.com`],
      );
      function release(reservationId: string, actorAdminId: string) {
        const command = {
          reservationId,
          actorAdminId,
          sendMessage: true,
          replacement: { mode: "chosen" as const, waitlistEntryId: chosen.id },
        };
        return stage === "IN_REVIEW"
          ? rejectRequest(repository, command)
          : cancelRequest(repository, { ...command, expectedStage: stage });
      }
      const results = await fireBehindHeldEventLock(event.id, [
        () => release(first.id, adminId),
        () => release(second.id, secondAdmin.rows[0]!.id),
      ]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const failures = results.filter((result) => !result.ok);
      expect(failures).toEqual([{ ok: false, code: "WAITLIST_CHANGED" }]);
      await expect(
        pool.query("SELECT status FROM reservations WHERE id = $1", [second.id]),
      ).resolves.toMatchObject({ rows: [{ status: "CONFIRMED" }] });
      await expect(
        pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [head.id]),
      ).resolves.toMatchObject({ rows: [{ status: "WAITING" }] });
      await expect(
        pool.query("SELECT COUNT(*)::int AS count FROM messages WHERE event_id = $1", [event.id]),
      ).resolves.toMatchObject({ rows: [{ count: 2 }] });
      await assertInvariants(event.id);
    },
  );

  it("keeps oversold at zero when twenty chosen replacements race a public submission", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 1,
      waitlistCapacity: 50,
    });
    const reservations: InsertedReservation[] = [];
    const chosenEntries: InsertedWaitlistEntry[] = [];
    const head = await insertWaitlistEntry(event.id, "Cabeza Conservada");
    for (let index = 0; index < 20; index += 1) {
      reservations.push(await insertReservation(event.id, `Sale Elegida ${index}`));
      chosenEntries.push(await insertWaitlistEntry(event.id, `Entra Elegida ${index}`));
    }
    const operations: Array<() => ReturnType<typeof rejectRequest>> = [];
    for (const [index, reservation] of reservations.entries()) {
      operations.push(() =>
        rejectRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          replacement: { mode: "chosen", waitlistEntryId: chosenEntries[index]!.id },
        }),
      );
    }

    const [submission, ...replacements] = await race([
      () =>
        submitReservation({
          idempotencyKey: randomUUID(),
          body: reservationBody(event.slug, 2000),
          remoteIp: null,
          rateLimitSubject: "twenty-chosen-public",
        }),
      ...operations,
    ]);

    expect(submission).toMatchObject({ status: 202, body: { status: "WAITLISTED" } });
    expect(replacements).toHaveLength(20);
    for (const [index, result] of replacements.entries()) {
      expect(result).toMatchObject({
        ok: true,
        promoted: [{ entryId: chosenEntries[index]!.id }],
      });
    }
    await expect(
      pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [head.id]),
    ).resolves.toMatchObject({ rows: [{ status: "WAITING" }] });
    await expect(
      pool.query(
        `SELECT GREATEST(COALESCE((SELECT SUM(party_size)::int FROM reservations
                                    WHERE event_id = e.id AND status = 'CONFIRMED'), 0)
                        - capacity, 0) AS oversold,
                reserved_seats
           FROM events e WHERE id = $1`,
        [event.id],
      ),
    ).resolves.toMatchObject({ rows: [{ oversold: 0, reserved_seats: 20 }] });
    await assertInvariants(event.id);
  });

  it("serializes two simultaneous rejections and rolls back the stale waitlist preview", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 2,
      maxPartySize: 1,
      waitlistCapacity: 10,
    });
    const firstReservation = await insertReservation(event.id, "Revisión Uno");
    const secondReservation = await insertReservation(event.id, "Revisión Dos");
    const entries = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        insertWaitlistEntry(event.id, `Cola Rechazo ${index + 1}`),
      ),
    );

    const results = await fireBehindHeldEventLock(event.id, [
      () =>
        rejectRequest(repository, {
          reservationId: firstReservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          replacement: { mode: "auto", expectedPromotedEntryIds: [entries[0]!.id] },
        }),
      () =>
        rejectRequest(repository, {
          reservationId: secondReservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          replacement: { mode: "auto", expectedPromotedEntryIds: [entries[0]!.id] },
        }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.code === "WAITLIST_CHANGED"),
    ).toHaveLength(1);
    await expect(
      pool.query("SELECT status, stage FROM reservations WHERE id = $1", [secondReservation.id]),
    ).resolves.toMatchObject({ rows: [{ status: "CONFIRMED", stage: "IN_REVIEW" }] });
    await expect(
      pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [entries[1]!.id]),
    ).resolves.toMatchObject({ rows: [{ status: "WAITING" }] });
    await assertInvariants(event.id);
  });

  it("promotes the existing head while fifty public submissions race for the freed seat", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      waitlistCapacity: 50,
    });
    const reservation = await insertReservation(event.id, "Rechazo Público");
    const head = await insertWaitlistEntry(event.id, "Cabeza Pública");

    const [rejection, ...submissions] = await race([
      () =>
        rejectRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          replacement: { mode: "auto", expectedPromotedEntryIds: [head.id] },
        }),
      ...Array.from(
        { length: 50 },
        (_, index) => () =>
          submitReservation({
            idempotencyKey: randomUUID(),
            body: reservationBody(event.slug, 1000 + index),
            remoteIp: null,
            rateLimitSubject: `reject-public-${index}`,
          }),
      ),
    ]);

    expect(rejection).toMatchObject({ ok: true, promoted: [{ entryId: head.id }] });
    expect(submissions).toHaveLength(50);
    const confirmed = await pool.query<{ id: string }>(
      `SELECT id
         FROM reservations
        WHERE event_id = $1 AND status = 'CONFIRMED'`,
      [event.id],
    );
    const promoted = await pool.query<{ promoted_reservation_id: string }>(
      "SELECT promoted_reservation_id FROM waitlist_entries WHERE id = $1",
      [head.id],
    );
    expect(confirmed.rows.map((row) => row.id)).toEqual([
      promoted.rows[0]!.promoted_reservation_id,
    ]);
    await assertInvariants(event.id);
  });

  it.each([
    { winner: "accept", expected: { status: "CONFIRMED", stage: "ON_LIST" } },
    { winner: "reject", expected: { status: "CANCELLED", stage: "IN_REVIEW" } },
  ] as const)(
    "lets exactly one of accept and reject win for the same request when $winner is first",
    async ({ winner, expected }) => {
      const event = await insertTestEvent(pool, { capacity: 1, maxPartySize: 1 });
      const reservation = await insertReservation(event.id, `Aceptar Rechazar ${winner}`);
      const accept = () =>
        acceptRequest(repository, { reservationId: reservation.id, actorAdminId: adminId });
      const reject = () =>
        rejectRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          replacement: { mode: "auto", expectedPromotedEntryIds: [] },
        });

      const [first, second] = await fireBehindHeldEventLock(
        event.id,
        winner === "accept" ? [accept, reject] : [reject, accept],
      );

      expect(first).toMatchObject({ ok: true });
      expect(second).toEqual({ ok: false, code: "INVALID_STAGE" });
      await expect(
        pool.query("SELECT status, stage FROM reservations WHERE id = $1", [reservation.id]),
      ).resolves.toMatchObject({ rows: [expected] });
      await assertInvariants(event.id);
    },
  );

  it("serializes party growth with thirty public submissions for the last seat", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 2,
      maxPartySize: 2,
      waitlistCapacity: 40,
    });
    const reservation = await insertReservation(event.id, "Crece", "IN_REVIEW", 1);
    const grownFields: GuestFields = {
      ...reservation.fields,
      partySize: 2,
      guest2Name: "Crece Dos",
      guest2Instagram: `${reservation.fields.guest1Instagram}.dos`,
    };

    const [growth, ...submissions] = await race([
      () =>
        updateRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          fields: grownFields,
        }),
      ...Array.from(
        { length: 30 },
        (_, index) => () =>
          submitReservation({
            idempotencyKey: randomUUID(),
            body: reservationBody(event.slug, 2000 + index),
            remoteIp: null,
            rateLimitSubject: `growth-public-${index}`,
          }),
      ),
    ]);

    expect(submissions).toHaveLength(30);
    const received = submissions.filter((result) => result.body.status === "RECEIVED");
    if (growth.ok) {
      expect(received).toHaveLength(0);
    } else {
      expect(growth).toEqual({ ok: false, code: "NO_SEAT" });
      expect(received).toHaveLength(1);
    }
    await assertInvariants(event.id);
  });

  it("serializes an admin add with thirty public submissions", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      waitlistCapacity: 31,
    });
    const adminFields = fields("Alta Administrativa");

    const [adminResult, ...submissions] = await race([
      () =>
        addRequest(repository, {
          eventId: event.id,
          actorAdminId: adminId,
          fields: adminFields,
          idempotencyKey: randomUUID(),
        }),
      ...Array.from(
        { length: 30 },
        (_, index) => () =>
          submitReservation({
            idempotencyKey: randomUUID(),
            body: reservationBody(event.slug, 3000 + index),
            remoteIp: null,
            rateLimitSubject: `add-public-${index}`,
          }),
      ),
    ]);

    expect(adminResult).toMatchObject({ ok: true });
    expect(submissions).toHaveLength(30);
    const publicReceived = submissions.filter((result) => result.body.status === "RECEIVED");
    if (adminResult.ok && adminResult.placement === "LIST") {
      expect(publicReceived).toHaveLength(0);
    } else {
      expect(publicReceived).toHaveLength(1);
      expect(adminResult).toMatchObject({ ok: true, placement: "QUEUE" });
    }
    await assertInvariants(event.id);
  });

  it.each([
    { first: "shrink", promotedEntry: "head", reorder: { ok: false, code: "AT_EDGE" } },
    { first: "reorder", promotedEntry: "second", reorder: { ok: true } },
  ] as const)(
    "promotes the $promotedEntry entry when a reorder races a shrink and $first goes first",
    async ({ first, promotedEntry, reorder: expectedReorder }) => {
      const event = await insertTestEvent(pool, {
        capacity: 2,
        maxPartySize: 2,
        waitlistCapacity: 3,
      });
      const reservation = await insertReservation(event.id, `Reduce ${first}`, "IN_REVIEW", 2);
      const head = await insertWaitlistEntry(event.id, `Cabeza Reordenada ${first}`);
      const second = await insertWaitlistEntry(event.id, `Segunda Reordenada ${first}`);
      const shrinkFields: GuestFields = {
        ...reservation.fields,
        partySize: 1,
        guest2Name: null,
        guest2Instagram: null,
      };
      const shrink = () =>
        updateRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          fields: shrinkFields,
        });
      const reorder = () =>
        moveEntry(repository, { entryId: second.id, actorAdminId: adminId, direction: "UP" });

      const results = await fireBehindHeldEventLock(
        event.id,
        first === "shrink" ? [shrink, reorder] : [reorder, shrink],
      );
      const shrinkResult = first === "shrink" ? results[0] : results[1];
      const reorderResult = first === "shrink" ? results[1] : results[0];

      expect(reorderResult).toMatchObject(expectedReorder);
      expect(shrinkResult).toMatchObject({
        ok: true,
        promoted: [{ entryId: promotedEntry === "head" ? head.id : second.id }],
      });
      await assertInvariants(event.id);
    },
  );

  it("serializes an admin override with FIFO promotion of the same entry", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 2,
      maxPartySize: 2,
      waitlistCapacity: 2,
    });
    const reservation = await insertReservation(event.id, "Reduce FIFO", "IN_REVIEW", 2);
    const head = await insertWaitlistEntry(event.id, "Misma Entrada");
    const shrunkFields: GuestFields = {
      ...reservation.fields,
      partySize: 1,
      guest2Name: null,
      guest2Instagram: null,
    };

    const [fifo, override] = await fireBehindHeldEventLock(event.id, [
      () =>
        updateRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          fields: shrunkFields,
        }),
      () => promoteEntry(repository, { entryId: head.id, actorAdminId: adminId }),
    ]);

    expect(fifo).toMatchObject({ ok: true, promoted: [{ entryId: head.id }] });
    expect(override).toEqual({ ok: false, code: "INVALID_STAGE" });
    await expect(
      pool.query(
        "SELECT COUNT(*)::int AS count FROM reservations WHERE event_id = $1 AND status = 'CONFIRMED'",
        [event.id],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
    await assertInvariants(event.id);
  });

  it("serializes admin adds with queue moves and removals", async () => {
    const moveEvent = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      waitlistCapacity: 4,
    });
    await insertReservation(moveEvent.id, "Ocupa Alta Mover");
    await insertWaitlistEntry(moveEvent.id, "Primera Mover");
    const second = await insertWaitlistEntry(moveEvent.id, "Segunda Mover");
    const [addedBeforeMove, moved] = await fireBehindHeldEventLock(moveEvent.id, [
      () =>
        addRequest(repository, {
          eventId: moveEvent.id,
          actorAdminId: adminId,
          fields: fields("Alta Mientras Mueve"),
          idempotencyKey: randomUUID(),
        }),
      () => moveEntry(repository, { entryId: second.id, actorAdminId: adminId, direction: "UP" }),
    ]);
    expect(addedBeforeMove).toMatchObject({ ok: true, placement: "QUEUE", position: 3 });
    expect(moved).toMatchObject({ ok: true });
    await assertInvariants(moveEvent.id);

    const removeEvent = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      waitlistCapacity: 3,
    });
    await insertReservation(removeEvent.id, "Ocupa Alta Remover");
    const removedEntry = await insertWaitlistEntry(removeEvent.id, "Primera Remover");
    const [addedBeforeRemove, removed] = await fireBehindHeldEventLock(removeEvent.id, [
      () =>
        addRequest(repository, {
          eventId: removeEvent.id,
          actorAdminId: adminId,
          fields: fields("Alta Mientras Remueve"),
          idempotencyKey: randomUUID(),
        }),
      () =>
        removeEntry(repository, {
          entryId: removedEntry.id,
          actorAdminId: adminId,
          sendMessage: false,
        }),
    ]);
    expect(addedBeforeRemove).toMatchObject({ ok: true, placement: "QUEUE", position: 2 });
    expect(removed).toMatchObject({ ok: true });
    await expect(
      pool.query(
        `SELECT waitlisted_count,
                (SELECT COUNT(*)::int FROM waitlist_entries
                  WHERE event_id = events.id AND status = 'WAITING') AS waiting_rows
           FROM events WHERE id = $1`,
        [removeEvent.id],
      ),
    ).resolves.toMatchObject({ rows: [{ waitlisted_count: 1, waiting_rows: 1 }] });
    await assertInvariants(removeEvent.id);
  });

  it("rolls back the second concurrent cancel when a party of two reaches the head", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 2,
      maxPartySize: 2,
      waitlistCapacity: 2,
    });
    const first = await insertReservation(event.id, "Cancela Uno", "ON_LIST");
    const second = await insertReservation(event.id, "Cancela Dos", "ON_LIST");
    const head = await insertWaitlistEntry(event.id, "Cabeza Pareja", 2);

    const results = await fireBehindHeldEventLock(
      event.id,
      [first, second].map(
        (reservation) => () =>
          cancelRequest(repository, {
            reservationId: reservation.id,
            actorAdminId: adminId,
            sendMessage: false,
            replacement: { mode: "auto", expectedPromotedEntryIds: [] },
            expectedStage: "ON_LIST",
          }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "WAITLIST_CHANGED" },
    ]);
    await expect(
      pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [head.id]),
    ).resolves.toMatchObject({ rows: [{ status: "WAITING" }] });
    await assertInvariants(event.id);
  });

  it.each([
    {
      first: "payment",
      expected: { status: "CONFIRMED", stage: "PAID", paid_at: expect.any(Date) },
    },
    { first: "cancellation", expected: { status: "CANCELLED", stage: "ON_LIST", paid_at: null } },
  ] as const)(
    "lets exactly one of cancel ON_LIST and payment verification commit when the $first is first",
    async ({ first, expected }) => {
      const event = await insertTestEvent(pool, { capacity: 1, maxPartySize: 1 });
      const reservation = await insertReservation(event.id, `Pago Cancelacion ${first}`, "ON_LIST");
      const pay = () =>
        verifyPayment(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          paymentNote: null,
        });
      const cancel = () =>
        cancelRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          replacement: { mode: "auto", expectedPromotedEntryIds: [] },
          expectedStage: "ON_LIST",
        });

      const [winner, loser] = await fireBehindHeldEventLock(
        event.id,
        first === "payment" ? [pay, cancel] : [cancel, pay],
      );

      expect(winner).toMatchObject({ ok: true });
      expect(loser).toEqual({ ok: false, code: "INVALID_STAGE" });
      // A cancellation decided on the unpaid stage must never leave a refund behind.
      await expect(
        pool.query("SELECT status, stage, paid_at, refund_status FROM reservations WHERE id = $1", [
          reservation.id,
        ]),
      ).resolves.toMatchObject({ rows: [{ ...expected, refund_status: null }] });
      await assertInvariants(event.id);
    },
  );

  it.each([
    { table: "reservations", contested: "QWE345", fresh: "TYU346", placement: "LIST" },
    { table: "waitlist_entries", contested: "RTY456", fresh: "ASD457", placement: "QUEUE" },
  ] as const)(
    "retries an admin add with a fresh link code when a concurrent transaction takes the code in $table",
    async ({ table, contested, fresh, placement }) => {
      const holderEvent = await insertTestEvent(pool, { capacity: 1, maxPartySize: 1 });
      const event = await insertTestEvent(pool, {
        capacity: 1,
        maxPartySize: 1,
        waitlistCapacity: 2,
      });
      if (placement === "QUEUE") await insertReservation(event.id, "Ocupa Codigo");
      const holder = await holdUncommittedLinkCode(table, holderEvent.id, contested);
      let committed = false;

      try {
        const codes: string[] = [contested, fresh];
        const racingRepository = new PostgresGuestAdminRepository(pool, () => codes.shift()!);
        const pending = addRequest(racingRepository, {
          eventId: event.id,
          actorAdminId: adminId,
          fields: fields("Codigo Concurrente"),
          idempotencyKey: randomUUID(),
        });
        await waitForBlockedInsert(table);
        await holder.query("COMMIT");
        committed = true;

        expect(await pending).toMatchObject({ ok: true, placement });
        expect(codes).toEqual([]);
      } finally {
        holder.release(!committed);
      }

      await expect(
        pool.query(`SELECT link_code FROM ${table} WHERE event_id = $1`, [event.id]),
      ).resolves.toMatchObject({ rows: [{ link_code: fresh }] });
      await expect(
        pool.query(`SELECT link_code FROM ${table} WHERE event_id = $1`, [holderEvent.id]),
      ).resolves.toMatchObject({ rows: [{ link_code: contested }] });
      await assertInvariants(event.id);
    },
  );
});
