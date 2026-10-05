import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCancelReservation } from "@/application/reservations/cancel-reservation";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import type { PostgresReservationAllocationRepository as Repository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import { resetTestDatabase } from "../helpers/test-db";
import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";

interface RequestResult {
  key: string;
  status: number;
  body: Record<string, unknown>;
}

interface InvariantSummary {
  confirmed: number;
  fullRejected: number;
  reservedSeats: number;
  capacity: number;
  oversold: number;
}

let pool: Pool;
let repository: Repository;
let submitReservation: ReturnType<typeof createSubmitReservation>;
let cancelReservation: ReturnType<typeof createCancelReservation>;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  const repositoryModule =
    await import("@/infrastructure/db/repositories/reservation-allocation-repository");
  pool = database.pool;
  repository = new repositoryModule.PostgresReservationAllocationRepository(pool);
  submitReservation = createSubmitReservation({
    repository,
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
  });
  cancelReservation = createCancelReservation(repository);
});

afterAll(async () => {
  await pool.end();
});

async function fireTogether(
  eventSlug: string,
  requests: Array<{
    key?: string;
    sequence: number;
    overrides?: Record<string, unknown>;
  }>,
): Promise<RequestResult[]> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = requests.map(async (request) => {
    const key = request.key ?? randomUUID();
    await barrier;
    const result = await submitReservation({
      idempotencyKey: key,
      body: reservationBody(eventSlug, request.sequence, request.overrides),
      remoteIp: "local",
    });
    return { key, status: result.status, body: result.body };
  });

  release();
  return Promise.all(pending);
}

function resultCode(result: RequestResult): string {
  if (result.body.status === "CONFIRMED") {
    return "CONFIRMED";
  }
  const error = result.body.error as { code?: string } | undefined;
  return error?.code ?? "UNKNOWN";
}

async function assertInvariants(
  eventId: string,
  requestResults: RequestResult[],
): Promise<InvariantSummary> {
  const eventResult = await pool.query<{
    capacity: number;
    reserved_seats: number;
    last_reservation_number: number;
  }>("SELECT capacity, reserved_seats, last_reservation_number FROM events WHERE id = $1", [
    eventId,
  ]);
  const event = eventResult.rows[0]!;
  const reservationResult = await pool.query<{
    status: string;
    party_size: number;
    reservation_number: number | null;
  }>(
    `SELECT status, party_size, reservation_number
       FROM reservations
      WHERE event_id = $1
      ORDER BY reservation_number NULLS LAST`,
    [eventId],
  );
  const confirmed = reservationResult.rows.filter((row) => row.status === "CONFIRMED");
  const fullRejected = reservationResult.rows.filter((row) => row.status === "FULL_REJECTED");
  const allocated = reservationResult.rows.filter(
    (row) => row.status === "CONFIRMED" || row.status === "CANCELLED",
  );
  const confirmedSeats = confirmed.reduce((sum, row) => sum + row.party_size, 0);
  const numbers = allocated
    .map((row) => row.reservation_number)
    .filter((number): number is number => number !== null)
    .sort((left, right) => left - right);
  const expectedNumbers = Array.from(
    { length: event.last_reservation_number },
    (_, index) => index + 1,
  );

  expect(event.reserved_seats).toBe(confirmedSeats);
  expect(event.reserved_seats).toBeLessThanOrEqual(event.capacity);
  expect(new Set(numbers).size).toBe(numbers.length);
  expect(numbers).toEqual(expectedNumbers);

  const duplicates = await pool.query(
    `SELECT 1
       FROM reservations
      WHERE event_id = $1 AND status = 'CONFIRMED'
      GROUP BY email_normalized
     HAVING COUNT(*) > 1
      UNION ALL
     SELECT 1
       FROM reservations
      WHERE event_id = $1 AND status = 'CONFIRMED'
      GROUP BY phone_e164
     HAVING COUNT(*) > 1`,
    [eventId],
  );
  expect(duplicates.rows).toHaveLength(0);

  const keys = [...new Set(requestResults.map((result) => result.key))];
  const idempotency = await pool.query<{ key: string; occurrences: number }>(
    `SELECT key::text, COUNT(*)::int AS occurrences
       FROM idempotency_records
      WHERE key = ANY($1::uuid[])
      GROUP BY key`,
    [keys],
  );
  expect(idempotency.rows.every((row) => row.occurrences === 1)).toBe(true);
  const storedKeys = new Set(idempotency.rows.map((row) => row.key));
  for (const result of requestResults) {
    if (resultCode(result) !== "DUPLICATE_RESERVATION" && resultCode(result) !== "TRY_AGAIN") {
      expect(storedKeys.has(result.key)).toBe(true);
    }
  }

  return {
    confirmed: confirmed.length,
    fullRejected: fullRejected.length,
    reservedSeats: event.reserved_seats,
    capacity: event.capacity,
    oversold: Math.max(0, event.reserved_seats - event.capacity),
  };
}

function printSummary(
  scenario: string,
  requests: number,
  results: RequestResult[],
  summary: InvariantSummary,
  durationMs: number,
): void {
  const otherOutcomes = results.filter(
    (result) => !["CONFIRMED", "EVENT_FULL"].includes(resultCode(result)),
  ).length;
  console.log(
    `CONCURRENCY ${scenario} requests=${requests} confirmed=${summary.confirmed} full_rejected=${summary.fullRejected} other=${otherOutcomes} reserved=${summary.reservedSeats}/${summary.capacity} oversold=${summary.oversold} duration_ms=${durationMs}`,
  );
}

async function seedReservations(eventSlug: string, count: number, offset: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const result = await submitReservation({
      idempotencyKey: randomUUID(),
      body: reservationBody(eventSlug, offset + index),
      remoteIp: "local",
    });
    expect(result.status).toBe(201);
  }
}

describe("reservation allocation concurrency", () => {
  it.each([1, 2, 3])(
    "A repeat %i: confirms exactly 20 of 100 simultaneous party-one requests",
    async (repeat) => {
      const event = await insertTestEvent(pool, { capacity: 20, maxPartySize: 1 });
      const requests = Array.from({ length: 100 }, (_, index) => ({
        sequence: repeat * 10_000 + index,
      }));
      const startedAt = performance.now();
      const results = await fireTogether(event.slug, requests);
      const durationMs = Math.round(performance.now() - startedAt);
      const summary = await assertInvariants(event.id, results);

      expect(results.filter((result) => resultCode(result) === "CONFIRMED")).toHaveLength(20);
      expect(summary.confirmed).toBe(20);
      expect(summary.oversold).toBe(0);
      printSummary(`A${repeat}`, requests.length, results, summary, durationMs);
    },
  );

  it.each([1, 2, 3])(
    "B repeat %i: does not oversell under 1,000 simultaneous requests",
    async (repeat) => {
      const event = await insertTestEvent(pool, { capacity: 20, maxPartySize: 1 });
      const requests = Array.from({ length: 1_000 }, (_, index) => ({
        sequence: repeat * 100_000 + index,
      }));
      const startedAt = performance.now();
      const results = await fireTogether(event.slug, requests);
      const durationMs = Math.round(performance.now() - startedAt);
      const summary = await assertInvariants(event.id, results);

      expect(summary.confirmed).toBe(20);
      expect(summary.oversold).toBe(0);
      printSummary(`B${repeat}`, requests.length, results, summary, durationMs);
    },
  );

  it("C: never partially allocates party-two requests when only one seat remains", async () => {
    const event = await insertTestEvent(pool, { capacity: 20, maxPartySize: 2 });
    await seedReservations(event.slug, 19, 300_000);
    const requests = Array.from({ length: 50 }, (_, index) => ({
      sequence: 310_000 + index,
      overrides: { partySize: 2 },
    }));
    const startedAt = performance.now();
    const results = await fireTogether(event.slug, requests);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect(results.filter((result) => resultCode(result) === "CONFIRMED")).toHaveLength(0);
    expect(summary.reservedSeats).toBe(19);
    printSummary("C", requests.length, results, summary, durationMs);
  });

  it("D: preserves invariants with mixed party sizes", async () => {
    const event = await insertTestEvent(pool, { capacity: 20, maxPartySize: 4 });
    const requests = Array.from({ length: 200 }, (_, index) => ({
      sequence: 400_000 + index,
      overrides: { partySize: (index % 4) + 1 },
    }));
    const startedAt = performance.now();
    const results = await fireTogether(event.slug, requests);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect(summary.reservedSeats).toBeLessThanOrEqual(20);
    expect(summary.oversold).toBe(0);
    printSummary("D", requests.length, results, summary, durationMs);
  });

  it("E: allocates exactly once for 50 simultaneous requests with the same key", async () => {
    const event = await insertTestEvent(pool, { capacity: 20, maxPartySize: 1 });
    const key = randomUUID();
    const requests = Array.from({ length: 50 }, () => ({
      key,
      sequence: 500_000,
    }));
    const startedAt = performance.now();
    const results = await fireTogether(event.slug, requests);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);
    const first = results[0]!;

    expect(summary.confirmed).toBe(1);
    expect(results.every((result) => result.status === first.status)).toBe(true);
    expect(
      results.every((result) => JSON.stringify(result.body) === JSON.stringify(first.body)),
    ).toBe(true);
    const idempotency = await pool.query(
      "SELECT COUNT(*)::int AS count FROM idempotency_records WHERE key = $1",
      [key],
    );
    expect(idempotency.rows[0]!.count).toBe(1);
    printSummary("E", requests.length, results, summary, durationMs);
  });

  it("F: confirms exactly one of 30 simultaneous requests sharing an email", async () => {
    const event = await insertTestEvent(pool, { capacity: 30, maxPartySize: 1 });
    const requests = Array.from({ length: 30 }, (_, index) => ({
      sequence: 600_000 + index,
      overrides: { email: "same-email@example.com" },
    }));
    const startedAt = performance.now();
    const results = await fireTogether(event.slug, requests);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect(results.filter((result) => resultCode(result) === "CONFIRMED")).toHaveLength(1);
    expect(results.filter((result) => resultCode(result) === "DUPLICATE_RESERVATION")).toHaveLength(
      29,
    );
    expect(summary.confirmed).toBe(1);
    printSummary("F", requests.length, results, summary, durationMs);
  });

  it("G: preserves invariants while cancelling five and submitting 50 on a full event", async () => {
    const event = await insertTestEvent(pool, { capacity: 20, maxPartySize: 1 });
    await seedReservations(event.slug, 20, 700_000);
    const reservations = await pool.query<{ id: string }>(
      `SELECT id FROM reservations
        WHERE event_id = $1 AND status = 'CONFIRMED'
        ORDER BY reservation_number
        LIMIT 5`,
      [event.id],
    );
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Concurrency Admin') RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    const requests = Array.from({ length: 50 }, (_, index) => ({
      sequence: 710_000 + index,
    }));
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedAt = performance.now();
    const submissions = requests.map(async (request) => {
      const key = randomUUID();
      await barrier;
      const result = await submitReservation({
        idempotencyKey: key,
        body: reservationBody(event.slug, request.sequence),
        remoteIp: "local",
      });
      return { key, status: result.status, body: result.body };
    });
    const cancellations = reservations.rows.map(async (reservation) => {
      await barrier;
      return cancelReservation({
        reservationId: reservation.id,
        actorAdminId: admin.rows[0]!.id,
      });
    });

    release();
    const [results, cancelResults] = await Promise.all([
      Promise.all(submissions),
      Promise.all(cancellations),
    ]);
    const durationMs = Math.round(performance.now() - startedAt);
    expect(cancelResults).toEqual(Array.from({ length: 5 }, () => "CANCELLED"));
    const summary = await assertInvariants(event.id, results);
    expect(summary.oversold).toBe(0);
    printSummary("G", requests.length, results, summary, durationMs);
  });
});
