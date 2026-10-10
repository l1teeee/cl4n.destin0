import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCancelReservation } from "@/application/reservations/cancel-reservation";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import type { PostgresEventRepository as EventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
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
  waiting: number;
  reservedSeats: number;
  capacity: number;
  oversold: number;
}

let pool: Pool;
let repository: Repository;
let EventRepositoryClass: typeof import("@/infrastructure/db/repositories/postgres-event-repository").PostgresEventRepository;
let eventRepository: EventRepository;
let submitReservation: ReturnType<typeof createSubmitReservation>;
let cancelReservation: ReturnType<typeof createCancelReservation>;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  const repositoryModule =
    await import("@/infrastructure/db/repositories/reservation-allocation-repository");
  const eventRepositoryModule =
    await import("@/infrastructure/db/repositories/postgres-event-repository");
  pool = database.pool;
  repository = new repositoryModule.PostgresReservationAllocationRepository(pool);
  EventRepositoryClass = eventRepositoryModule.PostgresEventRepository;
  eventRepository = new EventRepositoryClass(pool);
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
      remoteIp: null,
      rateLimitSubject: "unknown",
    });
    return { key, status: result.status, body: result.body };
  });

  release();
  return Promise.all(pending);
}

function resultCode(result: RequestResult): string {
  if (result.body.status === "CONFIRMED" || result.body.status === "WAITLISTED") {
    return result.body.status;
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
    waitlist_capacity: number;
    waitlisted_count: number;
    last_waitlist_number: number;
  }>(
    `SELECT capacity, reserved_seats, last_reservation_number,
            waitlist_capacity, waitlisted_count, last_waitlist_number
       FROM events WHERE id = $1`,
    [eventId],
  );
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

  const waitlistEntries = await pool.query<{ status: string; waitlist_number: number }>(
    `SELECT status, waitlist_number
       FROM waitlist_entries
      WHERE event_id = $1
      ORDER BY waitlist_number`,
    [eventId],
  );
  const waiting = waitlistEntries.rows.filter((row) => row.status === "WAITING");
  expect(event.waitlisted_count).toBe(waiting.length);
  expect(event.waitlisted_count).toBeLessThanOrEqual(event.waitlist_capacity);
  expect(waitlistEntries.rows.map((row) => row.waitlist_number)).toEqual(
    Array.from({ length: event.last_waitlist_number }, (_, index) => index + 1),
  );
  const promotedCount = waitlistEntries.rows.filter((row) => row.status === "PROMOTED").length;
  const promotedReservations = await pool.query(
    `SELECT 1
       FROM waitlist_entries w
       JOIN reservations r ON r.id = w.promoted_reservation_id
      WHERE w.event_id = $1 AND w.status = 'PROMOTED'`,
    [eventId],
  );
  expect(promotedReservations.rowCount).toBe(promotedCount);

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
    waiting: waiting.length,
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
    (result) => !["CONFIRMED", "WAITLISTED", "EVENT_FULL"].includes(resultCode(result)),
  ).length;
  console.log(
    `CONCURRENCY ${scenario} requests=${requests} confirmed=${summary.confirmed} full_rejected=${summary.fullRejected} waiting=${summary.waiting} other=${otherOutcomes} reserved=${summary.reservedSeats}/${summary.capacity} oversold=${summary.oversold} duration_ms=${durationMs}`,
  );
}

async function seedReservations(eventSlug: string, count: number, offset: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const result = await submitReservation({
      idempotencyKey: randomUUID(),
      body: reservationBody(eventSlug, offset + index),
      remoteIp: null,
      rateLimitSubject: "unknown",
    });
    expect(result.status).toBe(201);
  }
}

async function insertConcurrencyAdmin(): Promise<string> {
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, 'hash', 'Concurrency Admin') RETURNING id`,
    [`${randomUUID()}@example.com`],
  );
  return admin.rows[0]!.id;
}

async function fireWithOperations<T>(
  eventSlug: string,
  requests: Array<{ sequence: number; overrides?: Record<string, unknown> }>,
  operations: Array<() => Promise<T>>,
): Promise<{ results: RequestResult[]; operationResults: T[] }> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const submissions = requests.map(async (request) => {
    const key = randomUUID();
    await barrier;
    const result = await submitReservation({
      idempotencyKey: key,
      body: reservationBody(eventSlug, request.sequence, request.overrides),
      remoteIp: null,
      rateLimitSubject: "unknown",
    });
    return { key, status: result.status, body: result.body };
  });
  const running = operations.map(async (operation) => {
    await barrier;
    return operation();
  });

  release();
  const [results, operationResults] = await Promise.all([
    Promise.all(submissions),
    Promise.all(running),
  ]);
  return { results, operationResults };
}

async function seedWaitlist(
  eventSlug: string,
  entries: Array<{ sequence: number; partySize: number }>,
): Promise<void> {
  for (const entry of entries) {
    const result = await submitReservation({
      idempotencyKey: randomUUID(),
      body: reservationBody(eventSlug, entry.sequence, { partySize: entry.partySize }),
      remoteIp: null,
      rateLimitSubject: "unknown",
    });
    expect(result.status).toBe(202);
  }
}

async function confirmedReservationIds(eventId: string, limit: number): Promise<string[]> {
  const rows = await pool.query<{ id: string }>(
    `SELECT id FROM reservations
      WHERE event_id = $1 AND status = 'CONFIRMED' AND reservation_number IS NOT NULL
      ORDER BY reservation_number
      LIMIT $2`,
    [eventId, limit],
  );
  return rows.rows.map((row) => row.id);
}

async function waitlistStatuses(
  eventId: string,
): Promise<Array<{ number: number; status: string }>> {
  const rows = await pool.query<{ waitlist_number: number; status: string }>(
    `SELECT waitlist_number, status
       FROM waitlist_entries
      WHERE event_id = $1
      ORDER BY waitlist_number`,
    [eventId],
  );
  return rows.rows.map((row) => ({ number: row.waitlist_number, status: row.status }));
}

async function expectPromotionsInFifoOrder(eventId: string): Promise<number[]> {
  const promoted = await pool.query<{ waitlist_number: number; reservation_number: number }>(
    `SELECT w.waitlist_number, r.reservation_number
       FROM waitlist_entries w
       JOIN reservations r ON r.id = w.promoted_reservation_id
      WHERE w.event_id = $1 AND w.status = 'PROMOTED'
      ORDER BY w.waitlist_number`,
    [eventId],
  );
  const reservationNumbers = promoted.rows.map((row) => row.reservation_number);
  expect(reservationNumbers).toEqual([...reservationNumbers].sort((left, right) => left - right));
  return promoted.rows.map((row) => row.waitlist_number);
}

async function waitForEventLockWaiters(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const waiters = await pool.query<{ waiting: number }>(
      `SELECT COUNT(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (waiters.rows[0]!.waiting >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expected} requests waiting on the event lock`);
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

  it("never leaves one guest both confirmed and waiting in the cross-table duplicate race", async () => {
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const event = await insertTestEvent(pool, {
        capacity: 20,
        maxPartySize: 1,
        waitlistCapacity: 5,
      });
      await seedReservations(event.slug, 19, 650_000 + iteration * 100);
      const sharedIdentity = {
        email: `cross-table-${iteration}@example.com`,
        phone: "+50379999999",
      };
      const results = await fireTogether(event.slug, [
        { sequence: 653_000 + iteration * 2, overrides: sharedIdentity },
        { sequence: 653_001 + iteration * 2, overrides: sharedIdentity },
      ]);
      const summary = await assertInvariants(event.id, results);
      const identities = await pool.query<{ source: string }>(
        `SELECT 'CONFIRMED' AS source
           FROM reservations
          WHERE event_id = $1
            AND status = 'CONFIRMED'
            AND (email_normalized = $2 OR phone_e164 = $3)
          UNION ALL
         SELECT 'WAITING' AS source
           FROM waitlist_entries
          WHERE event_id = $1
            AND status = 'WAITING'
            AND (email_normalized = $2 OR phone_e164 = $3)`,
        [event.id, sharedIdentity.email, sharedIdentity.phone],
      );

      expect(results.map(resultCode).sort()).toEqual(["CONFIRMED", "DUPLICATE_RESERVATION"]);
      expect(identities.rows).toEqual([{ source: "CONFIRMED" }]);
      expect(summary.waiting).toBe(0);
    }
  });

  it("never confirms a guest who queued while the seat request waited on the event lock", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 2,
      waitlistCapacity: 5,
    });
    await seedReservations(event.slug, 19, 660_000);
    const guest = { email: "reverse-direction@example.com", phone: "+50379998888" };
    const holder = await pool.connect();
    let results: RequestResult[];

    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [event.id]);

      const queued = fireTogether(event.slug, [
        { sequence: 661_000, overrides: { ...guest, partySize: 2 } },
      ]);
      await waitForEventLockWaiters(1);
      const seated = fireTogether(event.slug, [
        { sequence: 661_001, overrides: { ...guest, partySize: 1 } },
      ]);
      await waitForEventLockWaiters(2);
      await holder.query("COMMIT");
      results = (await Promise.all([queued, seated])).flat();
    } finally {
      holder.release();
    }

    const summary = await assertInvariants(event.id, results);
    const identities = await pool.query<{ source: string }>(
      `SELECT 'CONFIRMED' AS source
         FROM reservations
        WHERE event_id = $1
          AND status = 'CONFIRMED'
          AND (email_normalized = $2 OR phone_e164 = $3)
        UNION ALL
       SELECT 'WAITING' AS source
         FROM waitlist_entries
        WHERE event_id = $1
          AND status = 'WAITING'
          AND (email_normalized = $2 OR phone_e164 = $3)`,
      [event.id, guest.email, guest.phone],
    );

    expect(results.map(resultCode)).toEqual(["WAITLISTED", "DUPLICATE_RESERVATION"]);
    expect(identities.rows).toEqual([{ source: "WAITING" }]);
    expect(summary.reservedSeats).toBe(19);
    expect(summary.waiting).toBe(1);
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
        remoteIp: null,
        rateLimitSubject: "unknown",
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

  it("H: preserves capacity during simultaneous allocation and a decrease to 12", async () => {
    const event = await insertTestEvent(pool, { capacity: 20, maxPartySize: 1 });
    await seedReservations(event.slug, 10, 800_000);
    const adminId = await insertConcurrencyAdmin();
    const requests = Array.from({ length: 30 }, (_, index) => ({
      sequence: 810_000 + index,
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
        remoteIp: null,
        rateLimitSubject: "unknown",
      });
      return { key, status: result.status, body: result.body };
    });
    const capacityChange = (async () => {
      await barrier;
      return eventRepository.changeCapacity(event.id, 12, adminId);
    })();

    release();
    const [results, capacityResult] = await Promise.all([Promise.all(submissions), capacityChange]);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect([12, 20]).toContain(summary.capacity);
    expect(summary.oversold).toBe(0);
    if (summary.capacity === 12) {
      expect(capacityResult.ok).toBe(true);
    } else {
      expect(capacityResult).toEqual({ ok: false, error: "CAPACITY_BELOW_ALLOCATED" });
    }
    printSummary("H", requests.length, results, summary, durationMs);
  });

  it("I: accepts no reservation after a concurrent CLOSE NOW commits", async () => {
    const event = await insertTestEvent(pool, { capacity: 50, maxPartySize: 1 });
    const adminId = await insertConcurrencyAdmin();
    const requests = Array.from({ length: 50 }, (_, index) => ({
      sequence: 900_000 + index,
    }));
    let closeCommitBoundary: Date | undefined;
    const observedClosePool = {
      async connect() {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return async (...arguments_: unknown[]) => {
                const query = arguments_[0];
                if (typeof query === "string" && query.includes("FOR UPDATE")) {
                  let confirmedExists = false;
                  for (let attempt = 0; attempt < 500 && !confirmedExists; attempt += 1) {
                    const state = await target.query<{ confirmed_exists: boolean }>(
                      `SELECT EXISTS (
                         SELECT 1 FROM reservations
                          WHERE event_id = $1 AND status = 'CONFIRMED'
                       ) AS confirmed_exists`,
                      [event.id],
                    );
                    confirmedExists = state.rows[0]!.confirmed_exists;
                    if (!confirmedExists) {
                      await target.query("SELECT pg_sleep(0.001)");
                    }
                  }
                  if (!confirmedExists) {
                    throw new Error("No allocation reached CONFIRMED before CLOSE NOW");
                  }
                }
                if (query === "COMMIT") {
                  const boundary = await target.query<{ database_now: Date }>(
                    "SELECT pg_sleep(0.01), clock_timestamp() AS database_now",
                  );
                  closeCommitBoundary = boundary.rows[0]!.database_now;
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
    const observedEventRepository = new EventRepositoryClass(observedClosePool);
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
        remoteIp: null,
        rateLimitSubject: "unknown",
      });
      return { key, status: result.status, body: result.body };
    });
    const close = (async () => {
      await barrier;
      return observedEventRepository.closeNow(event.id, adminId);
    })();

    release();
    const [results, closeResult] = await Promise.all([Promise.all(submissions), close]);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect(closeResult.ok).toBe(true);
    expect(closeCommitBoundary).toBeInstanceOf(Date);
    const confirmed = await pool.query<{ accepted_at: Date }>(
      "SELECT accepted_at FROM reservations WHERE event_id = $1 AND status = 'CONFIRMED'",
      [event.id],
    );
    expect(confirmed.rows.length).toBeGreaterThan(0);
    expect(
      confirmed.rows.every(
        (reservation) => reservation.accepted_at.getTime() < closeCommitBoundary!.getTime(),
      ),
    ).toBe(true);
    const afterClose = await submitReservation({
      idempotencyKey: randomUUID(),
      body: reservationBody(event.slug, 950_000),
      remoteIp: null,
      rateLimitSubject: "unknown",
    });
    expect(afterClose.status).not.toBe(201);
    expect(summary.oversold).toBe(0);
    printSummary("I", requests.length, results, summary, durationMs);
  });

  it("J: auto-closes exactly once when 100 requests fill 20 seats", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 1,
      autoCloseOnFull: true,
    });
    const requests = Array.from({ length: 100 }, (_, index) => ({
      sequence: 1_000_000 + index,
    }));
    const startedAt = performance.now();
    const results = await fireTogether(event.slug, requests);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);
    const finalState = await pool.query<{ status: string; closed_audits: number }>(
      `SELECT e.status,
              COUNT(a.id)::int AS closed_audits
         FROM events e
         LEFT JOIN audit_logs a
           ON a.entity_id = e.id
          AND a.actor_type = 'SYSTEM'
          AND a.action = 'EVENT_CLOSED'
        WHERE e.id = $1
        GROUP BY e.id`,
      [event.id],
    );

    expect(results.filter((result) => resultCode(result) === "CONFIRMED")).toHaveLength(20);
    expect(summary.confirmed).toBe(20);
    expect(finalState.rows[0]).toEqual({ status: "CLOSED", closed_audits: 1 });
    expect(summary.oversold).toBe(0);
    printSummary("J", requests.length, results, summary, durationMs);
  });

  it("WE: waitlists exactly five and rejects the rest of 100 requests on a 20-seat event", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 1,
      waitlistCapacity: 5,
    });
    const requests = Array.from({ length: 100 }, (_, index) => ({
      sequence: 1_100_000 + index,
    }));
    const startedAt = performance.now();
    const results = await fireTogether(event.slug, requests);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect(results.filter((result) => resultCode(result) === "CONFIRMED")).toHaveLength(20);
    expect(results.filter((result) => resultCode(result) === "WAITLISTED")).toHaveLength(5);
    expect(results.filter((result) => resultCode(result) === "EVENT_FULL")).toHaveLength(75);
    expect(await waitlistStatuses(event.id)).toEqual(
      [1, 2, 3, 4, 5].map((number) => ({ number, status: "WAITING" })),
    );
    expect(summary.reservedSeats).toBe(20);
    expect(summary.waiting).toBe(5);
    expect(summary.oversold).toBe(0);
    printSummary("WE", requests.length, results, summary, durationMs);
  });

  it("WF: promotes entries 1..3 in order while 50 new requests arrive during three cancellations", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 1,
      waitlistCapacity: 5,
    });
    await seedReservations(event.slug, 20, 1_200_000);
    await seedWaitlist(
      event.slug,
      Array.from({ length: 5 }, (_, index) => ({ sequence: 1_210_000 + index, partySize: 1 })),
    );
    const adminId = await insertConcurrencyAdmin();
    const cancellable = await confirmedReservationIds(event.id, 3);
    const requests = Array.from({ length: 50 }, (_, index) => ({
      sequence: 1_220_000 + index,
    }));
    const startedAt = performance.now();
    const { results, operationResults } = await fireWithOperations(
      event.slug,
      requests,
      cancellable.map(
        (reservationId) => () => cancelReservation({ reservationId, actorAdminId: adminId }),
      ),
    );
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect(operationResults).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
    expect(summary.reservedSeats).toBe(20);
    expect(await expectPromotionsInFifoOrder(event.id)).toEqual([1, 2, 3]);
    const codes = results.map(resultCode);
    expect(codes.filter((code) => code === "CONFIRMED")).toHaveLength(0);
    expect(codes.every((code) => code === "WAITLISTED" || code === "EVENT_FULL")).toBe(true);
    const joined = codes.filter((code) => code === "WAITLISTED").length;
    expect(joined).toBeLessThanOrEqual(3);
    expect(summary.waiting).toBe(2 + joined);
    expect(summary.oversold).toBe(0);
    printSummary("WF", requests.length, results, summary, durationMs);
  });

  it("WG: keeps strict FIFO and never skips a larger head for a smaller party", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 6,
      maxPartySize: 3,
      waitlistCapacity: 5,
    });
    const adminId = await insertConcurrencyAdmin();
    for (const [index, partySize] of [1, 2, 3].entries()) {
      const seeded = await submitReservation({
        idempotencyKey: randomUUID(),
        body: reservationBody(event.slug, 1_300_000 + index, { partySize }),
        remoteIp: null,
        rateLimitSubject: "unknown",
      });
      expect(seeded.status).toBe(201);
    }
    await seedWaitlist(event.slug, [
      { sequence: 1_310_000, partySize: 3 },
      { sequence: 1_310_001, partySize: 1 },
    ]);
    const [partyOne, partyTwo] = await confirmedReservationIds(event.id, 2);
    const startedAt = performance.now();

    expect(await cancelReservation({ reservationId: partyOne!, actorAdminId: adminId })).toBe(
      "CANCELLED",
    );
    expect(await waitlistStatuses(event.id)).toEqual([
      { number: 1, status: "WAITING" },
      { number: 2, status: "WAITING" },
    ]);
    const afterFirst = await pool.query<{ reserved_seats: number }>(
      "SELECT reserved_seats FROM events WHERE id = $1",
      [event.id],
    );
    expect(afterFirst.rows[0]!.reserved_seats).toBe(5);

    expect(await cancelReservation({ reservationId: partyTwo!, actorAdminId: adminId })).toBe(
      "CANCELLED",
    );
    const durationMs = Math.round(performance.now() - startedAt);
    expect(await waitlistStatuses(event.id)).toEqual([
      { number: 1, status: "PROMOTED" },
      { number: 2, status: "WAITING" },
    ]);
    const summary = await assertInvariants(event.id, []);

    expect(summary.reservedSeats).toBe(6);
    expect(summary.waiting).toBe(1);
    expect(summary.oversold).toBe(0);
    printSummary("WG", 0, [], summary, durationMs);
  });

  it("WH: promotes in FIFO order when an admin raises capacity during 30 requests", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 10,
      maxPartySize: 1,
      waitlistCapacity: 5,
    });
    await seedReservations(event.slug, 10, 1_400_000);
    await seedWaitlist(
      event.slug,
      Array.from({ length: 5 }, (_, index) => ({ sequence: 1_410_000 + index, partySize: 1 })),
    );
    const adminId = await insertConcurrencyAdmin();
    const requests = Array.from({ length: 30 }, (_, index) => ({
      sequence: 1_420_000 + index,
    }));
    const startedAt = performance.now();
    const { results, operationResults } = await fireWithOperations(event.slug, requests, [
      () => eventRepository.changeCapacity(event.id, 13, adminId),
    ]);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);

    expect(operationResults[0]!.ok).toBe(true);
    expect(summary.capacity).toBe(13);
    expect(summary.reservedSeats).toBe(13);
    expect(await expectPromotionsInFifoOrder(event.id)).toEqual([1, 2, 3]);
    const codes = results.map(resultCode);
    expect(codes.filter((code) => code === "CONFIRMED")).toHaveLength(0);
    expect(codes.every((code) => code === "WAITLISTED" || code === "EVENT_FULL")).toBe(true);
    expect(summary.oversold).toBe(0);
    printSummary("WH", requests.length, results, summary, durationMs);
  });

  it("WI: never exceeds the queue limit when joins race a capacity decrease", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      waitlistCapacity: 40,
    });
    await seedReservations(event.slug, 1, 1_500_000);
    const adminId = await insertConcurrencyAdmin();
    const requests = Array.from({ length: 50 }, (_, index) => ({
      sequence: 1_510_000 + index,
    }));
    const startedAt = performance.now();
    const { results, operationResults } = await fireWithOperations(event.slug, requests, [
      () => eventRepository.changeWaitlistCapacity(event.id, 10, adminId),
    ]);
    const durationMs = Math.round(performance.now() - startedAt);
    const summary = await assertInvariants(event.id, results);
    const finalState = await pool.query<{
      waitlist_capacity: number;
      waitlisted_count: number;
    }>("SELECT waitlist_capacity, waitlisted_count FROM events WHERE id = $1", [event.id]);
    const changeResult = operationResults[0]!;

    expect(finalState.rows[0]!.waitlisted_count).toBeLessThanOrEqual(
      finalState.rows[0]!.waitlist_capacity,
    );
    if (changeResult.ok) {
      expect(finalState.rows[0]!.waitlist_capacity).toBe(10);
    } else {
      expect(changeResult.error).toBe("WAITLIST_CAPACITY_BELOW_WAITING");
      expect(finalState.rows[0]!.waitlist_capacity).toBe(40);
    }
    expect(summary.oversold).toBe(0);
    printSummary("WI", requests.length, results, summary, durationMs);
  });
});
