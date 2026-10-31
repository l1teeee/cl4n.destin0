import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GuestFields } from "@/application/guests/guest-admin-repository";
import {
  acceptRequest,
  addRequest,
  cancelRequest,
  moveEntry,
  rejectRequest,
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
}

describe("guest admin concurrency", () => {
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

    const results = await race([
      () =>
        rejectRequest(repository, {
          reservationId: firstReservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          expectedPromotedEntryIds: [entries[0]!.id],
        }),
      () =>
        rejectRequest(repository, {
          reservationId: secondReservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          expectedPromotedEntryIds: [entries[0]!.id],
        }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.code === "WAITLIST_CHANGED"),
    ).toHaveLength(1);
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
          expectedPromotedEntryIds: [head.id],
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

  it("allows exactly one of accept and cancel to win for the same request", async () => {
    const event = await insertTestEvent(pool, { capacity: 1, maxPartySize: 1 });
    const reservation = await insertReservation(event.id, "Aceptar Cancelar");

    const [accepted, cancelled] = await race([
      () => acceptRequest(repository, { reservationId: reservation.id, actorAdminId: adminId }),
      () =>
        cancelRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          expectedPromotedEntryIds: [],
        }),
    ]);

    expect([accepted, cancelled].filter((result) => result.ok)).toHaveLength(1);
    expect([accepted, cancelled].filter((result) => !result.ok)).toEqual([
      { ok: false, code: "INVALID_STAGE" },
    ]);
    await assertInvariants(event.id);
  });

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
          linkCode: generateLinkCode(),
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

  it("promotes the head at commit time when reorder races a promotion", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 2,
      maxPartySize: 2,
      waitlistCapacity: 3,
    });
    const reservation = await insertReservation(event.id, "Reduce", "IN_REVIEW", 2);
    const head = await insertWaitlistEntry(event.id, "Cabeza Reordenada");
    const second = await insertWaitlistEntry(event.id, "Segunda Reordenada");
    const shrunkFields: GuestFields = {
      ...reservation.fields,
      partySize: 1,
      guest2Name: null,
      guest2Instagram: null,
    };

    const [shrink, reorder] = await race([
      () =>
        updateRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          fields: shrunkFields,
        }),
      () => moveEntry(repository, { entryId: second.id, actorAdminId: adminId, direction: "UP" }),
    ]);

    expect(shrink).toMatchObject({ ok: true });
    if (!shrink.ok) throw new Error("The shrink operation must succeed");
    expect(shrink.promoted).toHaveLength(1);
    expect(shrink.promoted[0]!.entryId).toBe(reorder.ok ? second.id : head.id);
    if (!reorder.ok) expect(reorder).toEqual({ ok: false, code: "AT_EDGE" });
    await assertInvariants(event.id);
  });

  it("keeps payment and cancellation consistent when they race", async () => {
    const event = await insertTestEvent(pool, { capacity: 1, maxPartySize: 1 });
    const reservation = await insertReservation(event.id, "Pago Cancelación", "ON_LIST");

    const [payment, cancellation] = await race([
      () =>
        verifyPayment(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          paymentNote: null,
        }),
      () =>
        cancelRequest(repository, {
          reservationId: reservation.id,
          actorAdminId: adminId,
          sendMessage: false,
          expectedPromotedEntryIds: [],
        }),
    ]);

    expect(cancellation).toMatchObject({ ok: true });
    const stored = await pool.query<{
      status: string;
      stage: string;
      paid_at: Date | null;
      refund_status: string | null;
    }>("SELECT status, stage, paid_at, refund_status FROM reservations WHERE id = $1", [
      reservation.id,
    ]);
    const row = stored.rows[0]!;
    expect(row.status).toBe("CANCELLED");
    if (payment.ok) {
      expect(row).toMatchObject({
        stage: "PAID",
        paid_at: expect.any(Date),
        refund_status: "PENDING",
      });
      expect(cancellation).toMatchObject({ refundPending: true });
    } else {
      expect(payment).toEqual({ ok: false, code: "INVALID_STAGE" });
      expect(row).toMatchObject({ stage: "ON_LIST", paid_at: null, refund_status: null });
      expect(cancellation).toMatchObject({ refundPending: false });
    }
    await assertInvariants(event.id);
  });
});
