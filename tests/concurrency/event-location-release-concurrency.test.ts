import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { PostgresEventLocationEmailRepository } from "@/infrastructure/db/repositories/postgres-event-location-email-repository";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

let pool: Pool;
let submitReservation: ReturnType<typeof createSubmitReservation>;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  submitReservation = createSubmitReservation({
    repository: new PostgresReservationAllocationRepository(pool),
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
  });
});

afterAll(async () => {
  await pool.end();
});

async function submit(eventSlug: string, sequence: number, partySize = 1) {
  return submitReservation({
    idempotencyKey: randomUUID(),
    body: reservationBody(eventSlug, sequence, { partySize }),
    remoteIp: null,
    rateLimitSubject: "unknown",
  });
}

describe("confirmed location email concurrency", () => {
  it("covers every concurrent direct confirmation and promotion exactly once", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 6,
      maxPartySize: 2,
      waitlistCapacity: 2,
    });
    for (let index = 0; index < 5; index += 1) {
      expect((await submit(event.slug, 2_000 + index)).status).toBe(201);
    }
    expect((await submit(event.slug, 2_100, 2)).status).toBe(202);
    await pool.query(
      `UPDATE events
          SET location_address = 'Concurrency location',
              location_status = 'CONFIRMED',
              location_confirmed_at = clock_timestamp()
        WHERE id = $1`,
      [event.id],
    );
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Concurrency Admin')
       RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    const locationRepository = new PostgresEventLocationEmailRepository(pool);
    const eventRepository = new PostgresEventRepository(pool);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const bulkSend = (async () => {
      await barrier;
      return locationRepository.queue(
        event.id,
        { revision: 0, status: "CONFIRMED" },
        admin.rows[0]!.id,
      );
    })();
    const capacityRaise = (async () => {
      await barrier;
      return eventRepository.changeCapacity(event.id, 8, admin.rows[0]!.id);
    })();
    const directReservation = (async () => {
      await barrier;
      return submit(event.slug, 2_200);
    })();

    release();
    const [sendResult, capacityResult, directResult] = await Promise.all([
      bulkSend,
      capacityRaise,
      directReservation,
    ]);

    expect(sendResult.ok).toBe(true);
    expect(capacityResult.ok).toBe(true);
    expect(directResult.status).toBe(201);
    const eventState = await pool.query<{
      capacity: number;
      reserved_seats: number;
      confirmed_seats: number;
      promoted: number;
      location_released_revision: number | null;
    }>(
      `SELECT e.capacity,
              e.reserved_seats,
              (
                SELECT COALESCE(SUM(r.party_size), 0)::int
                  FROM reservations r
                 WHERE r.event_id = e.id
                   AND r.status = 'CONFIRMED'
              ) AS confirmed_seats,
              (
                SELECT COUNT(*)::int
                  FROM waitlist_entries w
                 WHERE w.event_id = e.id
                   AND w.status = 'PROMOTED'
              ) AS promoted,
              e.location_released_revision
         FROM events e
        WHERE e.id = $1`,
      [event.id],
    );
    expect(eventState.rows[0]).toMatchObject({
      capacity: 8,
      reserved_seats: 8,
      confirmed_seats: 8,
      promoted: 1,
      location_released_revision: 0,
    });
    expect(eventState.rows[0]!.reserved_seats).toBeLessThanOrEqual(eventState.rows[0]!.capacity);

    const coverage = await pool.query<{
      reservation_id: string;
      location_rows: number;
    }>(
      `SELECT r.id AS reservation_id, COUNT(o.id)::int AS location_rows
         FROM reservations r
         LEFT JOIN email_outbox o
           ON o.reservation_id = r.id
          AND o.kind = 'EVENT_LOCATION'
          AND o.location_revision = 0
        WHERE r.event_id = $1
          AND r.status = 'CONFIRMED'
        GROUP BY r.id
        ORDER BY r.id`,
      [event.id],
    );
    expect(coverage.rows).toHaveLength(7);
    expect(coverage.rows.every((row) => row.location_rows === 1)).toBe(true);
  });
});
