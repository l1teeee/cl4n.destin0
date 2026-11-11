import { randomInt, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
} from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let submitReservation: ReturnType<typeof createSubmitReservation>;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString(), max: 50 });
  submitReservation = createSubmitReservation({
    repository: new PostgresReservationAllocationRepository(pool),
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
    generateLinkCode,
  });
});

afterAll(async () => {
  await pool.end();
});

function guestsOf(prefix: string, size: number) {
  return Array.from({ length: size }, (_, index) => ({
    name: `Invitado ${prefix} ${index}`,
    instagram: `${prefix}.${index}`,
  }));
}

function submit(slug: string, guests: ReturnType<typeof guestsOf>) {
  return submitReservation({
    idempotencyKey: randomUUID(),
    body: {
      eventSlug: slug,
      guests,
      hasAllergies: false,
      acceptTerms: true,
      turnstileToken: "test-token",
    },
    remoteIp: null,
    rateLimitSubject: "group-concurrency",
  });
}

async function burst(slug: string, groups: ReturnType<typeof guestsOf>[]) {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = groups.map(async (guests) => {
    await barrier;
    return submit(slug, guests);
  });
  release();
  return Promise.all(pending);
}

async function assertIntegrity(eventId: string) {
  const event = (
    await pool.query(
      `SELECT capacity, reserved_seats,
    COALESCE((SELECT sum(party_size)::int FROM reservations WHERE event_id = events.id
      AND status = 'CONFIRMED'), 0) AS allocated FROM events WHERE id = $1`,
      [eventId],
    )
  ).rows[0]!;
  expect(event.reserved_seats).toBeLessThanOrEqual(event.capacity);
  expect(event.reserved_seats).toBe(event.allocated);
  expect(Math.max(0, event.allocated - event.capacity)).toBe(0);
  const requests = await pool.query(
    `SELECT r.party_size,
    ARRAY(SELECT slot::int FROM request_guests WHERE reservation_id = r.id ORDER BY slot) AS slots
    FROM reservations r WHERE r.event_id = $1 AND r.status = 'CONFIRMED'`,
    [eventId],
  );
  for (const row of requests.rows) {
    expect(row.slots).toEqual(Array.from({ length: row.party_size - 1 }, (_, index) => index + 2));
  }
}

describe("concurrent allocation of groups", () => {
  it("never oversells or partially confirms 60 random groups of one through four", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 4,
      waitlistCapacity: 50,
    });
    const groups = Array.from({ length: 60 }, (_, index) =>
      guestsOf(`random${index}`, randomInt(1, 5)),
    );
    const results = await burst(event.slug, groups);
    for (const result of results) expect([201, 202, 409]).toContain(result.status);
    await assertIntegrity(event.id);
    const requests = await pool.query(
      `SELECT full_name, party_size, status FROM reservations
      WHERE event_id = $1 AND status = 'CONFIRMED'`,
      [event.id],
    );
    for (const request of requests.rows) {
      const submitted = groups.find((guests) => guests[0]!.name === request.full_name)!;
      expect(request.party_size).toBe(submitted.length);
    }
  });

  it("puts thirty groups of four in the queue or rejects them when only three seats remain", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 4,
      waitlistCapacity: 30,
    });
    for (let index = 0; index < 4; index += 1) {
      expect((await submit(event.slug, guestsOf(`taken${index}`, 4))).status).toBe(201);
    }
    expect((await submit(event.slug, guestsOf("takenlast", 1))).status).toBe(201);
    const results = await burst(
      event.slug,
      Array.from({ length: 30 }, (_, index) => guestsOf(`blocked${index}`, 4)),
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(0);
    for (const result of results) expect([202, 409]).toContain(result.status);
    expect(
      (await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id])).rows[0]!
        .reserved_seats,
    ).toBe(17);
    await assertIntegrity(event.id);
  });

  it("allows at most one active request when two groups share a companion handle", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 20,
      maxPartySize: 4,
      waitlistCapacity: 10,
    });
    const first = guestsOf("sharedfirst", 4);
    const second = guestsOf("sharedsecond", 4);
    first[2]!.instagram = "shared.companion";
    second[3]!.instagram = "shared.companion";
    const results = await burst(event.slug, [first, second]);
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(1);
    expect(results.find((result) => result.status === 409)!.body).toMatchObject({
      error: { code: "DUPLICATE_RESERVATION" },
    });
    const active = await pool.query(
      `SELECT count(*)::int AS count FROM request_guests g
      LEFT JOIN reservations r ON r.id = g.reservation_id
      LEFT JOIN waitlist_entries w ON w.id = g.waitlist_entry_id
      WHERE g.instagram_handle = 'shared.companion' AND (
        (r.event_id = $1 AND r.status = 'CONFIRMED') OR (w.event_id = $1 AND w.status = 'WAITING')
      )`,
      [event.id],
    );
    expect(active.rows[0]!.count).toBeLessThanOrEqual(1);
    await assertIntegrity(event.id);
  });
});
