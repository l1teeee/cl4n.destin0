import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

let pool: Pool;
let events: PostgresEventRepository;
let guests: PostgresGuestAdminRepository;
let submitReservation: ReturnType<typeof createSubmitReservation>;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  pool = database.pool;
  events = new PostgresEventRepository(pool);
  guests = new PostgresGuestAdminRepository(pool);
  submitReservation = createSubmitReservation({
    repository: new PostgresReservationAllocationRepository(pool),
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
    generateLinkCode,
  });
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('event-race@example.com', 'event-race@example.com', 'hash', 'Event Race')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

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
    if (result.rows[0]!.waiting >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${expected} operations waiting on the event lock`);
}

describe("event cancellation concurrency", () => {
  it.each(["event", "guest"] as const)(
    "keeps counters and cancellation counts consistent with 50 submissions when %s cancellation starts first",
    async (first) => {
      const event = await insertTestEvent(pool, { capacity: 60, waitlistCapacity: 50 });
      const existingKey = randomUUID();
      const existing = await submitReservation({
        idempotencyKey: existingKey,
        body: reservationBody(event.slug, 1000, { partySize: 2 }),
        remoteIp: "127.0.0.1",
        rateLimitSubject: "event-cancel-existing",
      });
      expect(existing.status).toBe(201);
      const reservation = await pool.query<{ id: string }>(
        `UPDATE reservations
            SET stage = 'PAID', on_list_at = clock_timestamp(), paid_at = clock_timestamp()
          WHERE idempotency_key = $1
          RETURNING id`,
        [existingKey],
      );
      const reservationId = reservation.rows[0]!.id;
      const cancelEvent = () => events.cancel(event.id, adminId);
      const cancelGuest = () =>
        guests.cancel({
          reservationId,
          actorAdminId: adminId,
          expectedStage: "PAID",
          sendMessage: true,
          replacement: { mode: "auto", expectedPromotedEntryIds: [] },
        });
      const submit = (index: number) =>
        submitReservation({
          idempotencyKey: randomUUID(),
          body: reservationBody(event.slug, index),
          remoteIp: "127.0.0.1",
          rateLimitSubject: `event-cancel-race-${index}`,
        });

      const holder = await pool.connect();
      let committed = false;
      let publicResults;
      let eventResult;
      let guestResult;
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [event.id]);
        // Queue ten submissions before cancellation, then race the remaining forty with it.
        const earlySubmissions = Array.from({ length: 10 }, (_, index) => submit(index + 1));
        await waitForEventLockWaiters(10);
        const firstCancellation = first === "event" ? cancelEvent() : cancelGuest();
        await waitForEventLockWaiters(11);
        const secondCancellation = first === "event" ? cancelGuest() : cancelEvent();
        await waitForEventLockWaiters(12);
        const laterSubmissions = Array.from({ length: 40 }, (_, index) => submit(index + 11));
        await holder.query("COMMIT");
        committed = true;
        const [firstResult, secondResult, submissions] = await Promise.all([
          firstCancellation,
          secondCancellation,
          Promise.all([...earlySubmissions, ...laterSubmissions]),
        ]);
        eventResult = first === "event" ? firstResult : secondResult;
        guestResult = first === "guest" ? firstResult : secondResult;
        publicResults = submissions;
      } finally {
        holder.release(!committed);
      }

      expect(eventResult.ok).toBe(true);
      if (!eventResult.ok || !("value" in eventResult)) {
        throw new Error("Event cancellation failed");
      }
      const guestCancelled = guestResult.ok;
      if (!guestCancelled) {
        expect(guestResult).toEqual({ ok: false, code: "INVALID_STAGE" });
      }
      const accepted = publicResults.filter((result) => result.status === 201).length;
      expect(publicResults).toHaveLength(50);
      for (const result of publicResults) {
        expect([201, 409]).toContain(result.status);
      }
      expect(eventResult.value.cancelledReservations).toBe(accepted + (guestCancelled ? 0 : 1));
      expect(eventResult.value.refundsPending).toBe(guestCancelled ? 0 : 1);
      const state = await pool.query(
        `SELECT e.status, e.reserved_seats, e.waitlisted_count,
                COALESCE((SELECT SUM(party_size)::int FROM reservations
                           WHERE event_id = e.id AND status = 'CONFIRMED'), 0) AS confirmed_seats,
                (SELECT COUNT(*)::int FROM waitlist_entries
                  WHERE event_id = e.id AND status = 'WAITING') AS waiting_rows
           FROM events e WHERE e.id = $1`,
        [event.id],
      );
      expect(state.rows).toEqual([
        {
          status: "CANCELLED",
          reserved_seats: 0,
          waitlisted_count: 0,
          confirmed_seats: 0,
          waiting_rows: 0,
        },
      ]);
      const paid = await pool.query(
        "SELECT status, refund_status FROM reservations WHERE id = $1",
        [reservationId],
      );
      expect(paid.rows).toEqual([{ status: "CANCELLED", refund_status: "PENDING" }]);
      const cancellations = await pool.query(
        `SELECT entity_id, metadata FROM audit_logs
          WHERE action = 'RESERVATION_CANCELLED' AND metadata->>'eventId' = $1`,
        [event.id],
      );
      expect(cancellations.rows).toHaveLength(accepted + 1);
      expect(new Set(cancellations.rows.map((row) => row.entity_id)).size).toBe(accepted + 1);
      expect(cancellations.rows.filter((row) => row.entity_id === reservationId)).toHaveLength(1);
      expect(
        cancellations.rows.filter((row) => row.metadata.reason === "EVENT_CANCELLED"),
      ).toHaveLength(eventResult.value.cancelledReservations);
      const messages = await pool.query(
        `SELECT reservation_id, kind FROM messages
          WHERE event_id = $1 AND kind IN ('CANCELLED_PAID', 'CANCELLED_UNPAID')`,
        [event.id],
      );
      expect(messages.rows).toHaveLength(accepted + 1);
      expect(new Set(messages.rows.map((row) => row.reservation_id)).size).toBe(accepted + 1);
      expect(messages.rows.filter((row) => row.kind === "CANCELLED_PAID")).toEqual([
        { reservation_id: reservationId, kind: "CANCELLED_PAID" },
      ]);
    },
  );
});
