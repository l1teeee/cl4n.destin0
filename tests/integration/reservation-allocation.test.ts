import { randomUUID } from "node:crypto";

import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCancelReservation } from "@/application/reservations/cancel-reservation";
import { mapReservationOutcome } from "@/application/reservations/reservation-response";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import type { AllocationCommand } from "@/application/ports/reservation-allocation-repository";
import type { PostgresReservationAllocationRepository as Repository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";

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
    fullName: "Retry Guest",
    instagramHandle: "retry.guest",
    phoneE164: "+50371009999",
    email: "retry@example.com",
    emailNormalized: "retry@example.com",
    partySize: 1,
    notes: "Retry test",
    allergies: null,
    mapOutcome: mapReservationOutcome,
  };
}

describe("reservation allocation repository", () => {
  it("allocates a confirmed reservation with DB timestamps, normalized contacts, audit and idempotency", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();
    const result = await submit(
      event.slug,
      1,
      {
        email: "  PERSON@Example.COM ",
        phone: "+503 7100-0001",
        hasAllergies: true,
        allergies: "  Maní  ",
      },
      key,
    );

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      status: "CONFIRMED",
      reservation: { number: 1, partySize: 1 },
    });
    const reservation = await pool.query<{
      id: string;
      email: string;
      email_normalized: string;
      phone_e164: string;
      status: string;
      reservation_number: number;
      allergies: string | null;
      submitted_at: Date;
      accepted_at: Date;
    }>("SELECT * FROM reservations WHERE idempotency_key = $1", [key]);
    expect(reservation.rows[0]).toMatchObject({
      email: "PERSON@Example.COM",
      email_normalized: "person@example.com",
      phone_e164: "+50371000001",
      status: "CONFIRMED",
      reservation_number: 1,
      allergies: "Maní",
    });
    expect(reservation.rows[0]!.submitted_at).toBeInstanceOf(Date);
    expect(reservation.rows[0]!.accepted_at).toBeInstanceOf(Date);

    const eventState = await pool.query(
      "SELECT reserved_seats, last_reservation_number FROM events WHERE id = $1",
      [event.id],
    );
    expect(eventState.rows[0]).toEqual({ reserved_seats: 1, last_reservation_number: 1 });

    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'RESERVATION_CREATED'",
      [reservation.rows[0]!.id],
    );
    expect(audit.rows[0]!.metadata).toEqual({
      eventId: event.id,
      reservationNumber: 1,
      partySize: 1,
    });
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toMatch(
      /allerg|email|phone|instagram|maní|person@example/i,
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
    const event = await insertTestEvent(pool, { capacity: 1, reservedSeats: 1, maxPartySize: 1 });
    const result = await submit(event.slug, 5, {
      hasAllergies: true,
      allergies: "Mariscos",
    });

    expect(result.body).toMatchObject({ error: { code: "EVENT_FULL" } });
    const reservation = await pool.query(
      `SELECT status, reservation_number, accepted_at, allergies
         FROM reservations WHERE event_id = $1`,
      [event.id],
    );
    expect(reservation.rows).toEqual([
      {
        status: "FULL_REJECTED",
        reservation_number: null,
        accepted_at: null,
        allergies: "Mariscos",
      },
    ]);
    const eventState = await pool.query(
      "SELECT reserved_seats, last_reservation_number FROM events WHERE id = $1",
      [event.id],
    );
    expect(eventState.rows[0]).toEqual({ reserved_seats: 1, last_reservation_number: 0 });
  });

  it("blocks confirmed duplicates by normalized email and phone", async () => {
    const event = await insertTestEvent(pool);
    expect((await submit(event.slug, 10)).status).toBe(201);

    const emailDuplicate = await submit(event.slug, 11, {
      email: "GUEST.10@example.com",
    });
    const phoneDuplicate = await submit(event.slug, 10, {
      email: "different@example.com",
    });

    expect(emailDuplicate.body).toMatchObject({ error: { code: "DUPLICATE_RESERVATION" } });
    expect(phoneDuplicate.body).toMatchObject({ error: { code: "DUPLICATE_RESERVATION" } });
    const counts = await pool.query(
      `SELECT COUNT(*)::int AS reservations,
              (SELECT reserved_seats FROM events WHERE id = $1) AS reserved_seats
         FROM reservations WHERE event_id = $1`,
      [event.id],
    );
    expect(counts.rows[0]).toEqual({ reservations: 1, reserved_seats: 1 });
  });

  it("does not treat cancelled or full-rejected contacts as duplicates", async () => {
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

    expect((await submit(event.slug, 20)).status).toBe(201);
    expect((await submit(event.slug, 21)).status).toBe(201);
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
      `SELECT e.reserved_seats, r.status, r.cancelled_at,
              (SELECT COUNT(*)::int FROM audit_logs
                WHERE entity_id = r.id AND action = 'RESERVATION_CANCELLED') AS audits
         FROM events e JOIN reservations r ON r.event_id = e.id
        WHERE r.id = $1`,
      [command.reservationId],
    );
    expect(state.rows[0]).toMatchObject({ reserved_seats: 0, status: "CANCELLED", audits: 1 });
    expect(state.rows[0]!.cancelled_at).toBeInstanceOf(Date);
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
