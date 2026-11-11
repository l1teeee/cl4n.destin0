import { randomUUID } from "node:crypto";

import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCancelReservation } from "@/application/reservations/cancel-reservation";
import { mapReservationOutcome } from "@/application/reservations/reservation-response";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import type { AllocationCommand } from "@/application/ports/reservation-allocation-repository";
import type { PostgresReservationAllocationRepository as Repository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";
import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";

let pool: Pool;
let repository: Repository;
let RepositoryClass: typeof import("@/infrastructure/db/repositories/reservation-allocation-repository").PostgresReservationAllocationRepository;
let submitReservation: ReturnType<typeof createSubmitReservation>;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  const repositoryModule =
    await import("@/infrastructure/db/repositories/reservation-allocation-repository");
  pool = database.pool;
  RepositoryClass = repositoryModule.PostgresReservationAllocationRepository;
  repository = new RepositoryClass(pool);
  submitReservation = createSubmitReservation({
    repository,
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
    generateLinkCode,
  });
});

afterAll(async () => {
  await pool.end();
});

async function submit(
  eventSlug: string,
  sequence = 1,
  bodyOverrides: Record<string, unknown> = {},
  key = randomUUID(),
) {
  return submitReservation({
    idempotencyKey: key,
    body: reservationBody(eventSlug, sequence, bodyOverrides),
    remoteIp: null,
    rateLimitSubject: "unknown",
  });
}

function allocationCommand(eventSlug: string, key = randomUUID()): AllocationCommand {
  return {
    idempotencyKey: key,
    fingerprint: `fingerprint-${key}`,
    eventSlug,
    guests: [{ name: "Retry Guest", instagram: "retry.guest" }],
    notes: "Retry test",
    allergies: null,
    linkCode: generateLinkCode(),
    mapOutcome: mapReservationOutcome,
  };
}

describe("reservation allocation repository", () => {
  it("allocates a received request with guest data, link code, audit and idempotency", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();
    const result = await submit(
      event.slug,
      1,
      {
        partySize: 2,
        guest1Instagram: " @PERSON.ONE ",
        guest2Name: "  Guest Two  ",
        guest2Instagram: " @PERSON.TWO ",
        hasAllergies: true,
        allergies: "  Maní  ",
      },
      key,
    );

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      status: "RECEIVED",
      request: { number: 1, partySize: 2, linkCode: expect.any(String) },
    });
    const reservation = await pool.query<{
      id: string;
      email: null;
      email_normalized: null;
      phone_e164: null;
      instagram_handle: string;
      link_code: string;
      source: string;
      stage: string;
      status: string;
      reservation_number: number;
      allergies: string | null;
      submitted_at: Date;
      accepted_at: Date;
    }>("SELECT * FROM reservations WHERE idempotency_key = $1", [key]);
    expect(reservation.rows[0]).toMatchObject({
      email: null,
      email_normalized: null,
      phone_e164: null,
      instagram_handle: "person.one",
      link_code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{6}$/),
      source: "PUBLIC",
      stage: "IN_REVIEW",
      status: "CONFIRMED",
      reservation_number: 1,
      allergies: "Maní",
    });
    expect(reservation.rows[0]!.submitted_at).toBeInstanceOf(Date);
    expect(reservation.rows[0]!.accepted_at).toBeInstanceOf(Date);
    const companions = await pool.query(
      "SELECT slot, full_name, instagram_handle FROM request_guests WHERE reservation_id = $1 ORDER BY slot",
      [reservation.rows[0]!.id],
    );
    expect(companions.rows).toEqual([
      { slot: 2, full_name: "Guest Two", instagram_handle: "person.two" },
    ]);

    const eventState = await pool.query(
      "SELECT reserved_seats, last_reservation_number FROM events WHERE id = $1",
      [event.id],
    );
    expect(eventState.rows[0]).toEqual({ reserved_seats: 2, last_reservation_number: 1 });

    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'RESERVATION_CREATED'",
      [reservation.rows[0]!.id],
    );
    expect(audit.rows[0]!.metadata).toEqual({
      eventId: event.id,
      reservationNumber: 1,
      partySize: 2,
    });
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toMatch(
      /allerg|email|phone|instagram|maní|person\.one/i,
    );

    const idempotency = await pool.query(
      `SELECT response_status, response_body, reservation_id, completed_at
         FROM idempotency_records WHERE key = $1`,
      [key],
    );
    expect(idempotency.rows[0]).toMatchObject({
      response_status: 201,
      response_body: result.body,
      reservation_id: reservation.rows[0]!.id,
    });
    expect(idempotency.rows[0]!.completed_at).toBeInstanceOf(Date);
  });

  it("stores NULL when allergies are provided with a no answer", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();

    expect(
      (
        await submit(
          event.slug,
          101,
          { hasAllergies: false, allergies: "Este valor se debe ignorar" },
          key,
        )
      ).status,
    ).toBe(201);

    const reservation = await pool.query<{ allergies: string | null }>(
      "SELECT allergies FROM reservations WHERE idempotency_key = $1",
      [key],
    );
    expect(reservation.rows[0]).toEqual({ allergies: null });
  });

  it("returns not found for a missing or draft event and stores both outcomes", async () => {
    const draft = await insertTestEvent(pool, { status: "DRAFT" });
    const missingKey = randomUUID();
    const draftKey = randomUUID();

    const missing = await submit(`missing-${randomUUID()}`, 2, {}, missingKey);
    const draftResult = await submit(draft.slug, 3, {}, draftKey);

    expect([missing.status, draftResult.status]).toEqual([404, 404]);
    const stored = await pool.query(
      "SELECT key, response_status FROM idempotency_records WHERE key = ANY($1::uuid[]) ORDER BY key",
      [[missingKey, draftKey]],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every((row) => row.response_status === 404)).toBe(true);
  });

  it.each([
    [{ status: "CLOSED" as const }, "EVENT_NOT_OPEN", 409],
    [{ opensOffset: "1 hour", closesOffset: "2 hours" }, "EVENT_NOT_OPEN", 409],
    [{ opensOffset: "-2 hours", closesOffset: "-1 hour" }, "EVENT_NOT_OPEN", 409],
    [{ maxPartySize: 1 }, "PARTY_SIZE_NOT_ALLOWED", 422],
  ])("classifies rejected allocation %#", async (options, code, status) => {
    const event = await insertTestEvent(pool, options);
    const result = await submit(event.slug, 4, { partySize: 2 });

    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ error: { code } });
    const rows = await pool.query("SELECT * FROM reservations WHERE event_id = $1", [event.id]);
    expect(rows.rows).toHaveLength(0);
  });

  it("stores a FULL_REJECTED row without changing counters", async () => {
    const event = await insertTestEvent(pool, { capacity: 2, reservedSeats: 2, maxPartySize: 2 });
    const result = await submit(event.slug, 5, {
      partySize: 2,
      hasAllergies: true,
      allergies: "Mariscos",
    });

    expect(result.body).toMatchObject({ error: { code: "EVENT_FULL" } });
    const reservation = await pool.query(
      `SELECT status, reservation_number, accepted_at, allergies, link_code,
              source,
              email, email_normalized, phone_e164
         FROM reservations WHERE event_id = $1`,
      [event.id],
    );
    expect(reservation.rows).toEqual([
      {
        status: "FULL_REJECTED",
        reservation_number: null,
        accepted_at: null,
        allergies: null,
        link_code: null,
        source: "PUBLIC",
        email: null,
        email_normalized: null,
        phone_e164: null,
      },
    ]);
    const eventState = await pool.query(
      "SELECT reserved_seats, last_reservation_number FROM events WHERE id = $1",
      [event.id],
    );
    expect(eventState.rows[0]).toEqual({ reserved_seats: 2, last_reservation_number: 0 });
    const companions = await pool.query(
      `SELECT g.slot, g.full_name, g.instagram_handle FROM request_guests g
       JOIN reservations r ON r.id = g.reservation_id WHERE r.event_id = $1`,
      [event.id],
    );
    expect(companions.rows).toEqual([
      { slot: 2, full_name: "Guest 5 Companion", instagram_handle: "guest.5.companion" },
    ]);
  });

  it("blocks confirmed duplicates across either guest position", async () => {
    const event = await insertTestEvent(pool);
    expect((await submit(event.slug, 10, { partySize: 2 })).status).toBe(201);

    const guest1Duplicate = await submit(event.slug, 11, {
      guest1Instagram: "GUEST.10.COMPANION",
    });
    const guest2Duplicate = await submit(event.slug, 12, {
      partySize: 2,
      guest2Instagram: "GUEST.10",
    });

    expect(guest1Duplicate.body).toMatchObject({ error: { code: "DUPLICATE_RESERVATION" } });
    expect(guest2Duplicate.body).toMatchObject({ error: { code: "DUPLICATE_RESERVATION" } });
    const counts = await pool.query(
      `SELECT COUNT(*)::int AS reservations,
              (SELECT reserved_seats FROM events WHERE id = $1) AS reserved_seats
         FROM reservations WHERE event_id = $1`,
      [event.id],
    );
    expect(counts.rows[0]).toEqual({ reservations: 1, reserved_seats: 2 });
  });

  it("does not treat cancelled or full-rejected handles as duplicates", async () => {
    const event = await insertTestEvent(pool);
    await pool.query(
      `INSERT INTO reservations (
         event_id, status, full_name, instagram_handle, phone_e164, email,
         email_normalized, party_size, terms_accepted_at, idempotency_key,
         submitted_at, cancelled_at
       ) VALUES
       ($1, 'FULL_REJECTED', 'Old Full', 'old.full', '+50371000020',
        'guest.20@example.com', 'guest.20@example.com', 1, now(), $2, now(), NULL),
       ($1, 'CANCELLED', 'Old Cancelled', 'old.cancelled', '+50371000021',
        'guest.21@example.com', 'guest.21@example.com', 1, now(), $3, now(), now())`,
      [event.id, randomUUID(), randomUUID()],
    );

    expect((await submit(event.slug, 20, { guest1Instagram: "old.full" })).status).toBe(201);
    expect((await submit(event.slug, 21, { guest1Instagram: "old.cancelled" })).status).toBe(201);
  });

  it("auto-closes on the last seat and classifies later attempts as full", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      autoCloseOnFull: true,
    });

    expect((await submit(event.slug, 30)).status).toBe(201);
    const later = await submit(event.slug, 31);

    expect(later.body).toMatchObject({ error: { code: "EVENT_FULL" } });
    const eventState = await pool.query("SELECT status, reserved_seats FROM events WHERE id = $1", [
      event.id,
    ]);
    expect(eventState.rows[0]).toEqual({ status: "CLOSED", reserved_seats: 1 });
    const closedAudit = await pool.query(
      "SELECT actor_type, metadata FROM audit_logs WHERE entity_id = $1 AND action = 'EVENT_CLOSED'",
      [event.id],
    );
    expect(closedAudit.rows).toEqual([
      { actor_type: "SYSTEM", metadata: { reason: "CAPACITY_REACHED" } },
    ]);
  });

  it("rolls back and returns TRY_AGAIN when the event lock exceeds three seconds", async () => {
    const event = await insertTestEvent(pool);
    const blocker = new Client({ connectionString: testDatabaseUrl().toString() });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [event.id]);
    const key = randomUUID();

    try {
      const result = await submit(event.slug, 40, {}, key);
      expect(result.status).toBe(503);
      expect(result.body).toMatchObject({ error: { code: "TRY_AGAIN" } });
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }

    const state = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM reservations WHERE event_id = $1) AS reservations,
         (SELECT COUNT(*)::int FROM idempotency_records WHERE key = $2) AS idempotency,
         (SELECT reserved_seats FROM events WHERE id = $1) AS reserved_seats`,
      [event.id, key],
    );
    expect(state.rows[0]).toEqual({ reservations: 0, idempotency: 0, reserved_seats: 0 });
  });

  it("rolls back and returns unstored TRY_AGAIN when an UPDATE miss re-reads free seats", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();
    const updateMissPool = {
      async connect() {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return (...arguments_: unknown[]) => {
                const query = arguments_[0];
                if (
                  typeof query === "string" &&
                  query.includes("SET reserved_seats = reserved_seats +")
                ) {
                  return Promise.resolve({
                    command: "UPDATE",
                    rowCount: 0,
                    oid: 0,
                    fields: [],
                    rows: [],
                  });
                }
                return Reflect.apply(target.query, target, arguments_);
              };
            }

            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    } as unknown as Pool;
    const forcedMissRepository = new RepositoryClass(updateMissPool);

    const result = await forcedMissRepository.allocate(allocationCommand(event.slug, key));

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "TRY_AGAIN" } });
    const state = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM reservations WHERE event_id = $1) AS reservations,
         (SELECT COUNT(*)::int FROM idempotency_records WHERE key = $2) AS idempotency,
         (SELECT reserved_seats FROM events WHERE id = $1) AS reserved_seats`,
      [event.id, key],
    );
    expect(state.rows[0]).toEqual({ reservations: 0, idempotency: 0, reserved_seats: 0 });
  });

  // Each case has its own codes: a code left in one table by an earlier case would otherwise
  // be caught by the cross-table check instead of the unique index under test.
  it.each([
    { path: "seat", collidingCode: "AB23CD", retryCode: "EF45GH" },
    { path: "waitlist", collidingCode: "JK67MN", retryCode: "PQ89RS" },
  ] as const)(
    "returns unstored TRY_AGAIN for a $path link-code collision and generates a new code on retry",
    async ({ path, collidingCode, retryCode }) => {
      const event = await insertTestEvent(pool, {
        capacity: 1,
        maxPartySize: 1,
        waitlistCapacity: path === "waitlist" ? 1 : 0,
      });
      if (path === "waitlist") {
        await submit(event.slug, 450);
        await pool.query(
          `INSERT INTO waitlist_entries (
             event_id, waitlist_number, status, full_name, instagram_handle,
             party_size, terms_accepted_at, link_code, idempotency_key,
             submitted_at, cancelled_at
           ) VALUES ($1, 999, 'CANCELLED', 'Old Guest', 'old.waiter', 1,
                     now(), $3, $2, now(), now())`,
          [event.id, randomUUID(), collidingCode],
        );
      } else {
        await pool.query(
          `INSERT INTO reservations (
             event_id, status, full_name, instagram_handle, party_size,
             terms_accepted_at, link_code, idempotency_key, submitted_at, cancelled_at
           ) VALUES ($1, 'CANCELLED', 'Old Guest', 'old.seat', 1,
                     now(), $3, $2, now(), now())`,
          [event.id, randomUUID(), collidingCode],
        );
      }

      const generatedCodes = [collidingCode, retryCode];
      const collisionSubmit = createSubmitReservation({
        repository,
        rateLimiter: allowAllRateLimiter,
        botVerifier: allowAllBotVerifier,
        computeFingerprint: requestFingerprint,
        generateLinkCode: () => generatedCodes.shift()!,
      });
      const key = randomUUID();
      const input = {
        idempotencyKey: key,
        body: reservationBody(event.slug, 451),
        remoteIp: null,
        rateLimitSubject: "unknown",
      };

      const collision = await collisionSubmit(input);
      expect(collision.body).toMatchObject({ error: { code: "TRY_AGAIN" } });
      const afterCollision = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM idempotency_records WHERE key = $1) AS idempotency,
           (SELECT reserved_seats FROM events WHERE id = $2) AS reserved_seats,
           (SELECT waitlisted_count FROM events WHERE id = $2) AS waitlisted_count`,
        [key, event.id],
      );
      expect(afterCollision.rows[0]).toEqual({
        idempotency: 0,
        reserved_seats: path === "waitlist" ? 1 : 0,
        waitlisted_count: 0,
      });

      const retry = await collisionSubmit(input);
      expect(retry.status).toBe(path === "waitlist" ? 202 : 201);
      expect(JSON.stringify(retry.body)).toContain(retryCode);
    },
  );

  it.each([
    {
      path: "waitlist",
      holder: "CANCELLED reservation",
      collidingCode: "KM47PQ",
      retryCode: "TV56WX",
    },
    {
      path: "seat",
      holder: "WAITING waitlist entry",
      collidingCode: "YZ23BC",
      retryCode: "DF89GH",
    },
  ] as const)(
    "returns unstored TRY_AGAIN when the $path path draws a code held by a $holder of another event",
    async ({ path, collidingCode, retryCode }) => {
      const event = await insertTestEvent(pool, {
        capacity: 1,
        maxPartySize: 1,
        waitlistCapacity: path === "waitlist" ? 1 : 0,
      });
      const otherEvent = await insertTestEvent(pool);
      const seatsTakenBeforeCollision = path === "waitlist" ? 1 : 0;
      if (path === "waitlist") {
        await submit(event.slug, 470);
        await pool.query(
          `INSERT INTO reservations (
             event_id, status, full_name, instagram_handle, party_size,
             terms_accepted_at, link_code, idempotency_key, submitted_at, cancelled_at
           ) VALUES ($1, 'CANCELLED', 'Old Guest', 'old.seat', 1,
                     now(), $3, $2, now(), now())`,
          [otherEvent.id, randomUUID(), collidingCode],
        );
      } else {
        await pool.query(
          `INSERT INTO waitlist_entries (
             event_id, waitlist_number, status, full_name, instagram_handle,
             party_size, terms_accepted_at, link_code, idempotency_key, submitted_at
           ) VALUES ($1, 1, 'WAITING', 'Old Guest', 'old.waiter', 1,
                     now(), $3, $2, now())`,
          [otherEvent.id, randomUUID(), collidingCode],
        );
      }

      const generatedCodes = [collidingCode, retryCode];
      const collisionSubmit = createSubmitReservation({
        repository,
        rateLimiter: allowAllRateLimiter,
        botVerifier: allowAllBotVerifier,
        computeFingerprint: requestFingerprint,
        generateLinkCode: () => generatedCodes.shift()!,
      });
      const key = randomUUID();
      const input = {
        idempotencyKey: key,
        body: reservationBody(event.slug, 471),
        remoteIp: null,
        rateLimitSubject: "unknown",
      };

      const collision = await collisionSubmit(input);
      expect(collision.status).toBe(503);
      expect(collision.body).toMatchObject({ error: { code: "TRY_AGAIN" } });
      const afterCollision = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM idempotency_records WHERE key = $1) AS idempotency,
           (SELECT COUNT(*)::int FROM reservations WHERE event_id = $2) AS reservations,
           (SELECT COUNT(*)::int FROM waitlist_entries WHERE event_id = $2) AS waitlist_entries,
           (SELECT COUNT(*)::int FROM messages WHERE event_id = $2) AS messages,
           reserved_seats, last_reservation_number, waitlisted_count, last_waitlist_number
         FROM events WHERE id = $2`,
        [key, event.id],
      );
      expect(afterCollision.rows[0]).toEqual({
        idempotency: 0,
        reservations: seatsTakenBeforeCollision,
        waitlist_entries: 0,
        messages: seatsTakenBeforeCollision,
        reserved_seats: seatsTakenBeforeCollision,
        last_reservation_number: seatsTakenBeforeCollision,
        waitlisted_count: 0,
        last_waitlist_number: 0,
      });

      const retry = await collisionSubmit(input);
      expect(retry.status).toBe(path === "waitlist" ? 202 : 201);
      expect(JSON.stringify(retry.body)).toContain(retryCode);
    },
  );

  it.each([
    ["pool connect timeout", new Error("timeout exceeded when trying to connect")],
    ["connection refused", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })],
    ["connection reset", Object.assign(new Error("reset"), { code: "ECONNRESET" })],
    ["connection timeout", Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })],
    ["too many connections", Object.assign(new Error("too many"), { code: "53300" })],
    ["admin shutdown", Object.assign(new Error("shutdown"), { code: "57P01" })],
    ["crash shutdown", Object.assign(new Error("crash"), { code: "57P02" })],
    ["cannot connect now", Object.assign(new Error("unavailable"), { code: "57P03" })],
  ])("maps %s acquisition failures to TRY_AGAIN", async (_case, connectionError) => {
    const failingPool = {
      connect: () => Promise.reject(connectionError),
    } as unknown as Pool;
    const failingRepository = new RepositoryClass(failingPool);

    const result = await failingRepository.allocate(allocationCommand("unused-event"));

    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: "TRY_AGAIN" } });
  });
});

describe("reservation cancellation", () => {
  it("releases seats once and audits the admin action", async () => {
    const event = await insertTestEvent(pool);
    await submit(event.slug, 50, { partySize: 2 });
    const reservation = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE event_id = $1",
      [event.id],
    );
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Cancellation Admin') RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    const cancelReservation = createCancelReservation(repository);
    const command = {
      reservationId: reservation.rows[0]!.id,
      actorAdminId: admin.rows[0]!.id,
    };

    expect(await cancelReservation(command)).toBe("CANCELLED");
    expect(await cancelReservation(command)).toBe("NOT_CANCELLABLE");
    expect(await cancelReservation({ ...command, reservationId: randomUUID() })).toBe("NOT_FOUND");

    const state = await pool.query(
      `SELECT e.reserved_seats, r.status, r.cancelled_at, r.release_reason, r.refund_status,
              (SELECT COUNT(*)::int FROM audit_logs
                WHERE entity_id = r.id AND action = 'RESERVATION_CANCELLED') AS audits
         FROM events e JOIN reservations r ON r.event_id = e.id
        WHERE r.id = $1`,
      [command.reservationId],
    );
    expect(state.rows[0]).toMatchObject({
      reserved_seats: 0,
      status: "CANCELLED",
      release_reason: "CANCELLED",
      refund_status: null,
      audits: 1,
    });
    expect(state.rows[0]!.cancelled_at).toBeInstanceOf(Date);
  });

  it("sets a pending refund only when cancelling a paid reservation", async () => {
    const event = await insertTestEvent(pool);
    await submit(event.slug, 51);
    const reservation = await pool.query<{ id: string }>(
      `UPDATE reservations
          SET stage = 'PAID', on_list_at = now(), paid_at = now()
        WHERE event_id = $1
      RETURNING id`,
      [event.id],
    );
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Refund Admin') RETURNING id`,
      [`${randomUUID()}@example.com`],
    );

    expect(
      await repository.cancelReservation({
        reservationId: reservation.rows[0]!.id,
        actorAdminId: admin.rows[0]!.id,
      }),
    ).toBe("CANCELLED");

    const cancelled = await pool.query(
      "SELECT release_reason, refund_status FROM reservations WHERE id = $1",
      [reservation.rows[0]!.id],
    );
    expect(cancelled.rows[0]).toEqual({
      release_reason: "CANCELLED",
      refund_status: "PENDING",
    });
  });

  it("does not cancel a full-rejected reservation", async () => {
    const event = await insertTestEvent(pool, { capacity: 1, reservedSeats: 1, maxPartySize: 1 });
    await submit(event.slug, 60);
    const reservation = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE event_id = $1",
      [event.id],
    );
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Cancellation Admin') RETURNING id`,
      [`${randomUUID()}@example.com`],
    );

    expect(
      await repository.cancelReservation({
        reservationId: reservation.rows[0]!.id,
        actorAdminId: admin.rows[0]!.id,
      }),
    ).toBe("NOT_CANCELLABLE");
  });
});
