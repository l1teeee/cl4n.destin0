import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { PostgresEventLocationEmailRepository } from "@/infrastructure/db/repositories/postgres-event-location-email-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let locationRepository: PostgresEventLocationEmailRepository;
let actorId: string;

beforeEach(async () => {
  await pool?.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString(), max: 10 });
  locationRepository = new PostgresEventLocationEmailRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, 'hash', 'Admin') RETURNING id`,
    [`${randomUUID()}@example.com`],
  );
  actorId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

function submit(eventSlug: string, sequence: number) {
  return createSubmitReservation({
    repository: new PostgresReservationAllocationRepository(pool),
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
  })({
    idempotencyKey: randomUUID(),
    body: reservationBody(eventSlug, sequence),
    remoteIp: null,
    rateLimitSubject: "unknown",
  });
}

async function confirmLocation(eventId: string): Promise<void> {
  await pool.query(
    `UPDATE events
        SET location_address = 'Calle revelada',
            location_status = 'CONFIRMED',
            location_confirmed_at = clock_timestamp()
      WHERE id = $1`,
    [eventId],
  );
}

async function holdEventLock(eventId: string): Promise<PoolClient> {
  const holder = await pool.connect();
  await holder.query("BEGIN");
  await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
  return holder;
}

async function waitUntilSomeoneIsBlocked(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'`,
    );
    if (waiting.rows[0]!.count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("No backend became blocked on the event row lock");
}

async function insertConfirmedReservation(
  client: Pick<PoolClient, "query">,
  eventId: string,
  number: number,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
       email, email_normalized, party_size, terms_accepted_at, idempotency_key,
       submitted_at, accepted_at
     ) VALUES ($1, $2, 'CONFIRMED', $3, $4, $5, $6, $6, 1, now(), gen_random_uuid(), now(), now())
     RETURNING id`,
    [
      eventId,
      number,
      `Guest ${number}`,
      `guest${number}`,
      `+5037${String(number).padStart(7, "0")}`,
      `${randomUUID()}@example.com`,
    ],
  );
  await client.query(
    `UPDATE events
        SET reserved_seats = reserved_seats + 1,
            last_reservation_number = GREATEST(last_reservation_number, $2)
      WHERE id = $1`,
    [eventId, number],
  );
  return result.rows[0]!.id;
}

async function locationRowCounts(eventId: string) {
  const result = await pool.query<{ reservation_id: string; rows: number; revisions: number[] }>(
    `SELECT r.id AS reservation_id,
            COUNT(o.id)::int AS rows,
            COALESCE(array_agg(o.location_revision) FILTER (WHERE o.id IS NOT NULL), '{}') AS revisions
       FROM reservations r
       LEFT JOIN email_outbox o
         ON o.reservation_id = r.id AND o.kind = 'EVENT_LOCATION'
      WHERE r.event_id = $1 AND r.status = 'CONFIRMED'
      GROUP BY r.id`,
    [eventId],
  );
  return new Map(result.rows.map((row) => [row.reservation_id, row]));
}

async function expectSeatsWithinCapacity(eventId: string): Promise<void> {
  const state = await pool.query<{ capacity: number; reserved_seats: number }>(
    "SELECT capacity, reserved_seats FROM events WHERE id = $1",
    [eventId],
  );
  expect(state.rows[0]!.reserved_seats).toBeLessThanOrEqual(state.rows[0]!.capacity);
}

describe("location email ordering behind the event row lock", () => {
  it("includes a guest whose confirmation commits before the bulk send runs", async () => {
    const event = await insertTestEvent(pool, { capacity: 5 });
    await confirmLocation(event.id);
    const earlierGuest = await insertConfirmedReservation(pool, event.id, 1);

    const holder = await holdEventLock(event.id);
    const lateGuest = await insertConfirmedReservation(holder, event.id, 2);
    const send = locationRepository.queue(event.id, { revision: 0, status: "CONFIRMED" }, actorId);
    await waitUntilSomeoneIsBlocked();
    await holder.query("COMMIT");
    holder.release();

    expect(await send).toMatchObject({ ok: true, queued: 2 });
    const counts = await locationRowCounts(event.id);
    expect(counts.get(earlierGuest)).toMatchObject({ rows: 1, revisions: [0] });
    expect(counts.get(lateGuest)).toMatchObject({ rows: 1, revisions: [0] });
    await expectSeatsWithinCapacity(event.id);
  });

  it("queues its own location email for a reservation waiting behind an uncommitted release", async () => {
    const event = await insertTestEvent(pool, { capacity: 5 });
    await confirmLocation(event.id);
    const earlierGuest = await insertConfirmedReservation(pool, event.id, 1);

    const holder = await holdEventLock(event.id);
    await holder.query(
      "UPDATE events SET location_released_revision = location_revision WHERE id = $1",
      [event.id],
    );
    await holder.query(
      `INSERT INTO email_outbox (kind, reservation_id, location_revision, payload)
       VALUES ('EVENT_LOCATION', $1, 0, '{"isUpdate": false}'::jsonb)`,
      [earlierGuest],
    );
    const reservation = submit(event.slug, 10);
    await waitUntilSomeoneIsBlocked();
    await holder.query("COMMIT");
    holder.release();

    expect((await reservation).status).toBe(201);
    const counts = await locationRowCounts(event.id);
    expect(counts.size).toBe(2);
    for (const row of counts.values()) {
      expect(row).toMatchObject({ rows: 1, revisions: [0] });
    }
    await expectSeatsWithinCapacity(event.id);
  });

  it("queues the current revision for a confirmation waiting behind a location text edit", async () => {
    const event = await insertTestEvent(pool, { capacity: 5 });
    await confirmLocation(event.id);
    const earlierGuest = await insertConfirmedReservation(pool, event.id, 1);
    expect(
      await locationRepository.queue(event.id, { revision: 0, status: "CONFIRMED" }, actorId),
    ).toMatchObject({ ok: true, queued: 1 });

    const holder = await holdEventLock(event.id);
    await holder.query(
      `UPDATE events
          SET location_address = 'Calle nueva', location_revision = location_revision + 1
        WHERE id = $1`,
      [event.id],
    );
    const reservation = submit(event.slug, 10);
    await waitUntilSomeoneIsBlocked();
    await holder.query("COMMIT");
    holder.release();

    expect((await reservation).status).toBe(201);
    const counts = await locationRowCounts(event.id);
    expect(counts.size).toBe(2);
    for (const [reservationId, row] of counts) {
      const expectedRevision = reservationId === earlierGuest ? 0 : 1;
      expect(row).toMatchObject({ rows: 1, revisions: [expectedRevision] });
    }
    const currentRevisionRows = await pool.query(
      "SELECT 1 FROM email_outbox WHERE kind = 'EVENT_LOCATION' AND location_revision = 1",
    );
    expect(currentRevisionRows.rowCount).toBe(1);
    await expectSeatsWithinCapacity(event.id);
  });

  it("returns TRY_AGAIN when the event row stays locked past the lock timeout", async () => {
    const event = await insertTestEvent(pool, { capacity: 5 });
    await confirmLocation(event.id);
    await insertConfirmedReservation(pool, event.id, 1);

    const holder = await holdEventLock(event.id);
    try {
      const result = await locationRepository.queue(
        event.id,
        { revision: 0, status: "CONFIRMED" },
        actorId,
      );
      expect(result).toEqual({ ok: false, error: "TRY_AGAIN" });
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }

    expect(
      await locationRepository.queue(event.id, { revision: 0, status: "CONFIRMED" }, actorId),
    ).toMatchObject({ ok: true, queued: 1 });
  }, 20_000);
});
