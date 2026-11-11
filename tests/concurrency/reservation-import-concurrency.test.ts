import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createImportReservations } from "@/application/reservations/import-reservations";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import type { ImportRowOutcome } from "@/contracts/guest-import";
import { buildImportRows } from "@/domain/guest-import/import-rows";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { importRowFingerprint, importRowKey } from "@/infrastructure/import/import-keys";

import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

let pool: Pool;
let adminId: string;
let importReservations: ReturnType<typeof createImportReservations>;
let submitReservation: ReturnType<typeof createSubmitReservation>;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  const { PostgresReservationAllocationRepository } =
    await import("@/infrastructure/db/repositories/reservation-allocation-repository");
  const repository = new PostgresReservationAllocationRepository(pool);
  importReservations = createImportReservations({
    repository,
    generateLinkCode,
    rowKey: importRowKey,
    rowFingerprint: importRowFingerprint,
  });
  submitReservation = createSubmitReservation({
    repository,
    generateLinkCode,
    computeFingerprint: requestFingerprint,
    botVerifier: allowAllBotVerifier,
    rateLimiter: allowAllRateLimiter,
  });
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name) VALUES ('concurrent-import@example.com', 'concurrent-import@example.com', 'hash', 'Admin') RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool?.end();
});

function importRows(mixed: boolean) {
  return buildImportRows(
    {
      headers: ["Nombre", "Instagram", "Acompañante", "Instagram 2"],
      rows: Array.from({ length: 30 }, (_, index) => [
        `Import ${index}`,
        `import.${index}`,
        mixed && index % 2 ? `Companion ${index}` : "",
        mixed && index % 2 ? `import.${index}.companion` : "",
      ]),
    },
    { guest1Name: 0, guest1Instagram: 1, companions: [{ name: 2, instagram: 3 }] },
    100,
  );
}

async function assertCapacity(eventId: string, importId: string, outcomes: ImportRowOutcome[]) {
  const state = await pool.query<{
    reserved_seats: number;
    capacity: number;
    seats: number;
    oversold: number;
  }>(
    `SELECT e.reserved_seats, e.capacity,
            COALESCE(SUM(r.party_size) FILTER (WHERE r.status = 'CONFIRMED'), 0)::int AS seats,
            GREATEST(0, e.reserved_seats - e.capacity)::int AS oversold
       FROM events e LEFT JOIN reservations r ON r.event_id = e.id
      WHERE e.id = $1 GROUP BY e.id`,
    [eventId],
  );
  expect(state.rows[0]!.reserved_seats).toBeLessThanOrEqual(20);
  expect(state.rows[0]!.reserved_seats).toBe(state.rows[0]!.seats);
  expect(state.rows[0]!.oversold).toBe(0);
  for (const outcome of outcomes.filter((row) => row.result === "RECEIVED")) {
    const reservation = await pool.query(
      "SELECT status, reservation_number FROM reservations WHERE event_id = $1 AND idempotency_key = $2",
      [eventId, importRowKey(importId, outcome.rowNumber)],
    );
    expect(reservation.rows).toEqual([
      { status: "CONFIRMED", reservation_number: outcome.reservationNumber },
    ]);
  }
}

describe("concurrent public and imported allocations", () => {
  it.each([false, true])(
    "never oversells capacity 20 during 30 imports and 100 public requests (mixed=%s)",
    async (mixed) => {
      const event = await insertTestEvent(pool, { capacity: 20, waitlistCapacity: 50 });
      const importId = randomUUID();
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const importing = (async () => {
        await barrier;
        return importReservations({
          eventId: event.id,
          adminId,
          importId,
          rows: importRows(mixed),
        });
      })();
      const publicRequests = Array.from({ length: 100 }, async (_, index) => {
        await barrier;
        return submitReservation({
          idempotencyKey: randomUUID(),
          body: reservationBody(event.slug, index, { partySize: mixed && index % 2 ? 2 : 1 }),
          remoteIp: null,
          rateLimitSubject: "test",
        });
      });
      release();
      const [outcomes, publicResults] = await Promise.all([importing, Promise.all(publicRequests)]);
      await assertCapacity(event.id, importId, outcomes);
      const received = publicResults.filter((row) => row.body.status === "RECEIVED");
      expect(received.length).toBeGreaterThan(0);
      for (const result of received) {
        const request = result.body.request as { number: number; partySize: number };
        const reservation = await pool.query(
          "SELECT status, party_size FROM reservations WHERE event_id = $1 AND reservation_number = $2",
          [event.id, request.number],
        );
        expect(reservation.rows).toEqual([{ status: "CONFIRMED", party_size: request.partySize }]);
      }
      expect(
        outcomes.every((row) => ["RECEIVED", "WAITLISTED", "EVENT_FULL"].includes(row.result)),
      ).toBe(true);
    },
  );

  it("creates only one set of rows for two concurrent runs of the same importId", async () => {
    const event = await insertTestEvent(pool, { capacity: 20, waitlistCapacity: 10 });
    const importId = randomUUID();
    const input = { eventId: event.id, adminId, importId, rows: importRows(false) };
    const [first, second] = await Promise.all([
      importReservations(input),
      importReservations(input),
    ]);
    expect(second).toEqual(first);
    await assertCapacity(event.id, importId, first);
    const state = await pool.query(
      "SELECT (SELECT COUNT(*)::int FROM reservations WHERE event_id = $1) AS reservations, (SELECT COUNT(*)::int FROM waitlist_entries WHERE event_id = $1) AS waiting, (SELECT COUNT(*)::int FROM messages WHERE event_id = $1) AS messages",
      [event.id],
    );
    expect(state.rows[0]).toEqual({ reservations: 20, waiting: 10, messages: 30 });
  });
});
