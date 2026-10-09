import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCancelReservation } from "@/application/reservations/cancel-reservation";
import { createCancelWaitlistEntry } from "@/application/reservations/cancel-waitlist-entry";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import type { PostgresEventRepository as EventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import type { PostgresReservationAllocationRepository as Repository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

let pool: Pool;
let RepositoryClass: typeof import("@/infrastructure/db/repositories/reservation-allocation-repository").PostgresReservationAllocationRepository;
let eventRepository: EventRepository;
let submitReservation: ReturnType<typeof createSubmitReservation>;
let cancelReservation: ReturnType<typeof createCancelReservation>;
let cancelWaitlistEntry: ReturnType<typeof createCancelWaitlistEntry>;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  const repositoryModule =
    await import("@/infrastructure/db/repositories/reservation-allocation-repository");
  const eventRepositoryModule =
    await import("@/infrastructure/db/repositories/postgres-event-repository");
  pool = database.pool;
  RepositoryClass = repositoryModule.PostgresReservationAllocationRepository;
  const repository: Repository = new RepositoryClass(pool);
  eventRepository = new eventRepositoryModule.PostgresEventRepository(pool);
  submitReservation = createSubmitReservation({
    repository,
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
  });
  cancelReservation = createCancelReservation(repository);
  cancelWaitlistEntry = createCancelWaitlistEntry(repository);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('waitlist-admin@example.com', 'waitlist-admin@example.com', 'hash', 'Admin')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

async function submit(
  eventSlug: string,
  sequence: number,
  overrides: Record<string, unknown> = {},
  key = randomUUID(),
) {
  return submitReservation({
    idempotencyKey: key,
    body: reservationBody(eventSlug, sequence, overrides),
    remoteIp: null,
    rateLimitSubject: "unknown",
  });
}

async function fullEventWithQueue(options: { waitlistCapacity?: number; seats?: number } = {}) {
  const seats = options.seats ?? 1;
  const event = await insertTestEvent(pool, {
    capacity: seats,
    maxPartySize: Math.min(2, seats),
    waitlistCapacity: options.waitlistCapacity ?? 3,
  });
  for (let index = 0; index < seats; index += 1) {
    expect((await submit(event.slug, 10 + index)).status).toBe(201);
  }
  return event;
}

async function outboxKinds(eventId: string): Promise<string[]> {
  const rows = await pool.query<{ kind: string }>(
    `SELECT o.kind
       FROM email_outbox o
       LEFT JOIN reservations r ON r.id = o.reservation_id
       LEFT JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
      WHERE r.event_id = $1 OR w.event_id = $1
      ORDER BY o.created_at, o.id`,
    [eventId],
  );
  return rows.rows.map((row) => row.kind).sort();
}

describe("waitlist admission", () => {
  it("queues a request when seats are gone and records audit, outbox and counters", async () => {
    const event = await fullEventWithQueue();
    const key = randomUUID();

    const result = await submit(event.slug, 20, { hasAllergies: true, allergies: "Lácteos" }, key);

    expect(result.status).toBe(202);
    expect(result.body).toEqual({
      status: "WAITLISTED",
      waitlist: {
        position: 1,
        partySize: 1,
        eventStartsAt: expect.any(String),
      },
    });
    const entry = await pool.query<{
      id: string;
      status: string;
      waitlist_number: number;
      allergies: string | null;
    }>(
      "SELECT id, status, waitlist_number, allergies FROM waitlist_entries WHERE idempotency_key = $1",
      [key],
    );
    expect(entry.rows[0]).toMatchObject({
      status: "WAITING",
      waitlist_number: 1,
      allergies: "Lácteos",
    });
    const state = await pool.query(
      `SELECT reserved_seats, waitlisted_count, last_waitlist_number
         FROM events WHERE id = $1`,
      [event.id],
    );
    expect(state.rows[0]).toEqual({
      reserved_seats: 1,
      waitlisted_count: 1,
      last_waitlist_number: 1,
    });
    const audit = await pool.query<{ actor_type: string; entity_type: string; metadata: unknown }>(
      `SELECT actor_type, entity_type, metadata
         FROM audit_logs WHERE entity_id = $1 AND action = 'RESERVATION_WAITLISTED'`,
      [entry.rows[0]!.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "PUBLIC",
        entity_type: "WAITLIST_ENTRY",
        metadata: { eventId: event.id, waitlistNumber: 1, partySize: 1 },
      },
    ]);
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toMatch(/allerg|lácteos/i);
    const outbox = await pool.query<{ payload: unknown; reservation_id: string | null }>(
      `SELECT payload, reservation_id FROM email_outbox
        WHERE kind = 'RESERVATION_WAITLISTED' AND waitlist_entry_id = $1`,
      [entry.rows[0]!.id],
    );
    expect(outbox.rows).toEqual([{ payload: { position: 1 }, reservation_id: null }]);
    const record = await pool.query(
      "SELECT reservation_id, waitlist_entry_id FROM idempotency_records WHERE key = $1",
      [key],
    );
    expect(record.rows[0]).toEqual({
      reservation_id: null,
      waitlist_entry_id: entry.rows[0]!.id,
    });
  });

  it("replays the stored 202 for the same key without a second entry", async () => {
    const event = await fullEventWithQueue();
    const key = randomUUID();

    const first = await submit(event.slug, 30, {}, key);
    const replay = await submit(event.slug, 30, {}, key);

    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual(first.body);
    const entries = await pool.query("SELECT 1 FROM waitlist_entries WHERE event_id = $1", [
      event.id,
    ]);
    expect(entries.rowCount).toBe(1);
  });

  it("returns EVENT_FULL once seats and queue are exhausted", async () => {
    const event = await fullEventWithQueue({ waitlistCapacity: 2 });
    expect((await submit(event.slug, 40)).status).toBe(202);
    expect((await submit(event.slug, 41)).status).toBe(202);

    const overflow = await submit(event.slug, 42);

    expect(overflow.status).toBe(409);
    expect(overflow.body).toMatchObject({ error: { code: "EVENT_FULL" } });
    const rejected = await pool.query(
      "SELECT 1 FROM reservations WHERE event_id = $1 AND status = 'FULL_REJECTED'",
      [event.id],
    );
    expect(rejected.rowCount).toBe(1);
  });

  it("does not queue when the queue is disabled", async () => {
    const event = await fullEventWithQueue({ waitlistCapacity: 0 });

    const result = await submit(event.slug, 50);

    expect(result.body).toMatchObject({ error: { code: "EVENT_FULL" } });
  });

  it("blocks duplicates across confirmed reservations and waiting entries", async () => {
    const event = await fullEventWithQueue();
    expect((await submit(event.slug, 60)).status).toBe(202);

    const againstConfirmedEmail = await submit(event.slug, 61, {
      email: "guest.10@example.com",
    });
    const againstWaitingEmail = await submit(event.slug, 62, { email: "GUEST.60@example.com" });
    const againstWaitingPhone = await submit(event.slug, 60, { email: "other@example.com" });

    for (const duplicate of [againstConfirmedEmail, againstWaitingEmail, againstWaitingPhone]) {
      expect(duplicate.status).toBe(409);
      expect(duplicate.body).toMatchObject({
        error: {
          code: "DUPLICATE_RESERVATION",
          message: "Ya existe una reservación o un lugar en la cola con este email o teléfono.",
        },
      });
    }
    const counters = await pool.query("SELECT waitlisted_count FROM events WHERE id = $1", [
      event.id,
    ]);
    expect(counters.rows[0]).toEqual({ waitlisted_count: 1 });
  });

  it("does not queue a party larger than the event maximum", async () => {
    const event = await fullEventWithQueue();

    const result = await submit(event.slug, 70, { partySize: 3 });

    expect(result.body).toMatchObject({ error: { code: "PARTY_SIZE_NOT_ALLOWED" } });
  });

  it("auto-closes only after seats and queue are both exhausted", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      waitlistCapacity: 1,
      autoCloseOnFull: true,
    });
    const statusOf = async () =>
      (await pool.query<{ status: string }>("SELECT status FROM events WHERE id = $1", [event.id]))
        .rows[0]!.status;

    expect((await submit(event.slug, 80)).status).toBe(201);
    expect(await statusOf()).toBe("SCHEDULED");
    expect((await submit(event.slug, 81)).status).toBe(202);
    expect(await statusOf()).toBe("CLOSED");

    const later = await submit(event.slug, 82);
    expect(later.body).toMatchObject({ error: { code: "EVENT_FULL" } });
    const closedAudits = await pool.query(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'EVENT_CLOSED'",
      [event.id],
    );
    expect(closedAudits.rows).toEqual([{ metadata: { reason: "CAPACITY_REACHED" } }]);
  });

  it("keeps the event open when the queue fills while a seat is still free", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 3,
      maxPartySize: 2,
      waitlistCapacity: 1,
      autoCloseOnFull: true,
    });
    const statusOf = async () =>
      (await pool.query<{ status: string }>("SELECT status FROM events WHERE id = $1", [event.id]))
        .rows[0]!.status;

    expect((await submit(event.slug, 70)).status).toBe(201);
    expect((await submit(event.slug, 71)).status).toBe(201);
    expect((await submit(event.slug, 72, { partySize: 2 })).status).toBe(202);
    expect(await statusOf()).toBe("SCHEDULED");

    expect((await submit(event.slug, 73)).status).toBe(201);
    expect(await statusOf()).toBe("CLOSED");
  });

  it("auto-closes on the last seat when the queue is already exhausted by configuration", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 1,
      maxPartySize: 1,
      waitlistCapacity: 0,
      autoCloseOnFull: true,
    });

    expect((await submit(event.slug, 90)).status).toBe(201);

    const state = await pool.query("SELECT status FROM events WHERE id = $1", [event.id]);
    expect(state.rows[0]).toEqual({ status: "CLOSED" });
  });
});

describe("waitlist promotion", () => {
  it("promotes the head when a confirmed reservation is cancelled", async () => {
    const event = await fullEventWithQueue();
    const queued = await submit(event.slug, 100, {
      partySize: 1,
      hasAllergies: true,
      allergies: "Nueces",
    });
    expect(queued.status).toBe(202);
    const confirmed = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE event_id = $1 AND status = 'CONFIRMED'",
      [event.id],
    );

    expect(
      await cancelReservation({ reservationId: confirmed.rows[0]!.id, actorAdminId: adminId }),
    ).toBe("CANCELLED");

    const promoted = await pool.query<{
      reservation_number: number;
      status: string;
      email_normalized: string;
      allergies: string | null;
    }>(
      `SELECT r.reservation_number, r.status, r.email_normalized, r.allergies
         FROM waitlist_entries w
         JOIN reservations r ON r.id = w.promoted_reservation_id
        WHERE w.event_id = $1 AND w.status = 'PROMOTED'`,
      [event.id],
    );
    expect(promoted.rows).toEqual([
      {
        reservation_number: 2,
        status: "CONFIRMED",
        email_normalized: "guest.100@example.com",
        allergies: "Nueces",
      },
    ]);
    const state = await pool.query(
      "SELECT reserved_seats, waitlisted_count FROM events WHERE id = $1",
      [event.id],
    );
    expect(state.rows[0]).toEqual({ reserved_seats: 1, waitlisted_count: 0 });
    const audit = await pool.query<{ actor_type: string; metadata: Record<string, unknown> }>(
      "SELECT actor_type, metadata FROM audit_logs WHERE action = 'WAITLIST_PROMOTED' AND metadata ->> 'eventId' = $1",
      [event.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_type).toBe("SYSTEM");
    expect(audit.rows[0]!.metadata).toMatchObject({ reservationNumber: 2, partySize: 1 });
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toMatch(/allerg|nueces/i);
    expect(await outboxKinds(event.id)).toEqual([
      "RESERVATION_CANCELLED",
      "RESERVATION_CONFIRMED",
      "RESERVATION_WAITLISTED",
      "WAITLIST_PROMOTED",
    ]);
  });

  it("keeps the original idempotent replay as the 202 after promotion", async () => {
    const event = await fullEventWithQueue();
    const key = randomUUID();
    const first = await submit(event.slug, 110, {}, key);
    const confirmed = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE event_id = $1 AND status = 'CONFIRMED'",
      [event.id],
    );
    await cancelReservation({ reservationId: confirmed.rows[0]!.id, actorAdminId: adminId });

    const replay = await submit(event.slug, 110, {}, key);

    expect(replay.status).toBe(202);
    expect(replay.body).toEqual(first.body);
  });

  it("promotes queued entries when an admin raises the capacity", async () => {
    const event = await fullEventWithQueue();
    await submit(event.slug, 120);
    await submit(event.slug, 121);

    const result = await eventRepository.changeCapacity(event.id, 3, adminId);

    expect(result.ok && result.value).toMatchObject({
      capacity: 3,
      reservedSeats: 3,
      waitlistedCount: 0,
    });
    const entries = await pool.query<{ status: string }>(
      "SELECT status FROM waitlist_entries WHERE event_id = $1 ORDER BY waitlist_number",
      [event.id],
    );
    expect(entries.rows.map((row) => row.status)).toEqual(["PROMOTED", "PROMOTED"]);
  });

  it("cancels a waiting entry that duplicates a confirmed reservation instead of promoting it", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 2,
      maxPartySize: 1,
      waitlistCapacity: 3,
      reservedSeats: 1,
    });
    await pool.query(
      `UPDATE events SET last_reservation_number = 1, waitlisted_count = 1,
                         last_waitlist_number = 1
        WHERE id = $1`,
      [event.id],
    );
    await pool.query(
      `INSERT INTO reservations (
         event_id, reservation_number, status, full_name, instagram_handle,
         phone_e164, email, email_normalized, party_size, terms_accepted_at,
         idempotency_key, submitted_at, accepted_at
       ) VALUES ($1, 1, 'CONFIRMED', 'Seat Holder', 'seat.holder', '+50370000001',
                 'dup@example.com', 'dup@example.com', 1, now(), $2, now(), now())`,
      [event.id, randomUUID()],
    );
    const entry = await pool.query<{ id: string }>(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle,
         phone_e164, email, email_normalized, party_size, terms_accepted_at,
         idempotency_key, submitted_at
       ) VALUES ($1, 1, 'WAITING', 'Dup Waiter', 'dup.waiter', '+50370000002',
                 'dup@example.com', 'dup@example.com', 1, now(), $2, now())
       RETURNING id`,
      [event.id, randomUUID()],
    );

    const result = await eventRepository.changeCapacity(event.id, 3, adminId);

    expect(result.ok).toBe(true);
    const cancelled = await pool.query(
      "SELECT status, cancelled_at IS NOT NULL AS has_cancelled_at FROM waitlist_entries WHERE id = $1",
      [entry.rows[0]!.id],
    );
    expect(cancelled.rows[0]).toEqual({ status: "CANCELLED", has_cancelled_at: true });
    const state = await pool.query(
      "SELECT reserved_seats, waitlisted_count FROM events WHERE id = $1",
      [event.id],
    );
    expect(state.rows[0]).toEqual({ reserved_seats: 1, waitlisted_count: 0 });
    const audit = await pool.query(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'WAITLIST_CANCELLED'",
      [entry.rows[0]!.id],
    );
    expect(audit.rows[0]!.metadata).toMatchObject({ reason: "DUPLICATE" });
    const outbox = await pool.query("SELECT 1 FROM email_outbox WHERE waitlist_entry_id = $1", [
      entry.rows[0]!.id,
    ]);
    expect(outbox.rowCount).toBe(0);
  });
});

describe("cancelWaitlistEntry", () => {
  it("cancels a waiting entry, frees its queue slot and queues the notice", async () => {
    const event = await fullEventWithQueue();
    await submit(event.slug, 130);
    const entry = await pool.query<{ id: string }>(
      "SELECT id FROM waitlist_entries WHERE event_id = $1",
      [event.id],
    );
    const entryId = entry.rows[0]!.id;

    expect(await cancelWaitlistEntry({ waitlistEntryId: entryId, actorAdminId: adminId })).toBe(
      "CANCELLED",
    );

    const state = await pool.query(
      "SELECT reserved_seats, waitlisted_count FROM events WHERE id = $1",
      [event.id],
    );
    expect(state.rows[0]).toEqual({ reserved_seats: 1, waitlisted_count: 0 });
    const stored = await pool.query(
      "SELECT status, cancelled_at IS NOT NULL AS has_cancelled_at FROM waitlist_entries WHERE id = $1",
      [entryId],
    );
    expect(stored.rows[0]).toEqual({ status: "CANCELLED", has_cancelled_at: true });
    const audit = await pool.query(
      "SELECT actor_type, actor_admin_id, entity_type FROM audit_logs WHERE entity_id = $1 AND action = 'WAITLIST_CANCELLED'",
      [entryId],
    );
    expect(audit.rows).toEqual([
      { actor_type: "ADMIN", actor_admin_id: adminId, entity_type: "WAITLIST_ENTRY" },
    ]);
    expect(await outboxKinds(event.id)).toContain("WAITLIST_CANCELLED");
  });

  it("does not promote anybody and cannot cancel twice or a promoted entry", async () => {
    const event = await fullEventWithQueue();
    await submit(event.slug, 140);
    await submit(event.slug, 141);
    const entries = await pool.query<{ id: string }>(
      "SELECT id FROM waitlist_entries WHERE event_id = $1 ORDER BY waitlist_number",
      [event.id],
    );
    const [first, second] = entries.rows;

    expect(await cancelWaitlistEntry({ waitlistEntryId: first!.id, actorAdminId: adminId })).toBe(
      "CANCELLED",
    );
    expect(await cancelWaitlistEntry({ waitlistEntryId: first!.id, actorAdminId: adminId })).toBe(
      "NOT_CANCELLABLE",
    );
    const stillWaiting = await pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [
      second!.id,
    ]);
    expect(stillWaiting.rows[0]).toEqual({ status: "WAITING" });

    await eventRepository.changeCapacity(event.id, 2, adminId);
    expect(await cancelWaitlistEntry({ waitlistEntryId: second!.id, actorAdminId: adminId })).toBe(
      "NOT_CANCELLABLE",
    );
  });

  it("returns NOT_FOUND for an unknown entry", async () => {
    expect(
      await cancelWaitlistEntry({ waitlistEntryId: randomUUID(), actorAdminId: adminId }),
    ).toBe("NOT_FOUND");
  });
});

describe("waitlist configuration", () => {
  it("rejects a queue smaller than the people already waiting", async () => {
    const event = await fullEventWithQueue();
    await submit(event.slug, 150);
    await submit(event.slug, 151);
    const current = await eventRepository.getAdminEvent(event.id);
    const detail = current.value!;
    const command = {
      id: event.id,
      internalName: detail.internalName,
      slug: detail.slug,
      startsAt: detail.startsAt,
      maxPartySize: detail.maxPartySize,
      opensAt: detail.opensAt,
      closesAt: detail.closesAt,
      autoCloseOnFull: detail.autoCloseOnFull,
      location: {
        name: detail.location.name,
        address: detail.location.address,
        mapsUrl: detail.location.mapsUrl,
        notes: detail.location.notes,
        status: detail.location.status,
      },
    };

    expect(await eventRepository.update({ ...command, waitlistCapacity: 1 }, adminId)).toEqual({
      ok: false,
      error: "WAITLIST_CAPACITY_BELOW_WAITING",
    });
    const accepted = await eventRepository.update({ ...command, waitlistCapacity: 2 }, adminId);
    expect(accepted.ok && accepted.value.waitlistCapacity).toBe(2);
  });
});

describe("email outbox atomicity", () => {
  it("writes the confirmation notice with the reservation", async () => {
    const event = await insertTestEvent(pool);

    expect((await submit(event.slug, 160)).status).toBe(201);

    expect(await outboxKinds(event.id)).toEqual(["RESERVATION_CONFIRMED"]);
  });

  it("leaves no outbox row, reservation or idempotency record when the allocation rolls back", async () => {
    const event = await insertTestEvent(pool);
    const failingPool = {
      query: (...queryArguments: Parameters<Pool["query"]>) =>
        Reflect.apply(pool.query, pool, queryArguments),
      async connect() {
        const client = await pool.connect();
        return new Proxy(client, {
          get(target, property) {
            if (property === "query") {
              return async (...queryArguments: unknown[]) => {
                const text = queryArguments[0];
                if (typeof text === "string" && text.includes("SET response_status")) {
                  throw new Error("simulated failure after the outbox insert");
                }
                return Reflect.apply(target.query, target, queryArguments);
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }) as PoolClient;
      },
    } as unknown as Pool;
    const failingRepository = new RepositoryClass(failingPool);
    const failingSubmit = createSubmitReservation({
      repository: failingRepository,
      rateLimiter: allowAllRateLimiter,
      botVerifier: allowAllBotVerifier,
      computeFingerprint: requestFingerprint,
    });
    const outboxBefore = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM email_outbox",
    );

    await expect(
      failingSubmit({
        idempotencyKey: randomUUID(),
        body: reservationBody(event.slug, 170),
        remoteIp: null,
        rateLimitSubject: "unknown",
      }),
    ).rejects.toThrow("simulated failure");

    const outboxAfter = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM email_outbox",
    );
    expect(outboxAfter.rows[0]!.count).toBe(outboxBefore.rows[0]!.count);
    const reservations = await pool.query("SELECT 1 FROM reservations WHERE event_id = $1", [
      event.id,
    ]);
    expect(reservations.rowCount).toBe(0);
    const state = await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id]);
    expect(state.rows[0]).toEqual({ reserved_seats: 0 });
  });
});
