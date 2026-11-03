import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { reopenEvent } from "@/application/events/event-use-cases";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import { insertAdminUser, insertGuestReservation } from "../helpers/guest-flow-test-data";
import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
  reservationBody,
} from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresEventRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventRepository(pool);
  adminId = await insertAdminUser(pool);
});

afterAll(async () => {
  await pool.end();
});

async function eventRow(id: string) {
  const result = await pool.query<Record<string, unknown>>("SELECT * FROM events WHERE id = $1", [
    id,
  ]);
  return result.rows[0]!;
}

async function openedAudits(id: string) {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT actor_type, actor_admin_id, entity_type, metadata
       FROM audit_logs
      WHERE entity_id = $1 AND action = 'EVENT_OPENED'`,
    [id],
  );
  return result.rows;
}

describe("event reopening", () => {
  it("reopens a closed window and audits it without changing reservations or the queue", async () => {
    const event = await insertTestEvent(pool, {
      status: "CLOSED",
      closesOffset: "-1 minute",
      waitlistCapacity: 3,
    });
    await insertGuestReservation(pool, event.id);
    await pool.query(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle,
         party_size, terms_accepted_at, idempotency_key, submitted_at
       ) VALUES ($1, 1, 'WAITING', 'Waiting Guest', 'waiting.guest', 1, now(), $2, now())`,
      [event.id, randomUUID()],
    );
    await pool.query(
      "UPDATE events SET waitlisted_count = 1, last_waitlist_number = 1 WHERE id = $1",
      [event.id],
    );
    const before = await eventRow(event.id);
    const reservations = await pool.query("SELECT * FROM reservations WHERE event_id = $1", [
      event.id,
    ]);
    const queue = await pool.query("SELECT * FROM waitlist_entries WHERE event_id = $1", [
      event.id,
    ]);
    const databaseTime = await repository.databaseTime();
    const closesAt = new Date(databaseTime.getTime() + 3_600_000);

    const result = await reopenEvent(repository, event.id, closesAt, adminId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.status).toBe("SCHEDULED");
    expect(result.value.opensAt.getTime()).toBeGreaterThanOrEqual(databaseTime.getTime());
    expect(result.value.opensAt.getTime()).toBeLessThan(closesAt.getTime());
    expect(result.value.closesAt).toEqual(closesAt);
    expect(await eventRow(event.id)).toEqual({
      ...before,
      status: "SCHEDULED",
      opens_at: result.value.opensAt,
      closes_at: closesAt,
      updated_at: expect.any(Date),
    });
    expect(
      (await pool.query("SELECT * FROM reservations WHERE event_id = $1", [event.id])).rows,
    ).toEqual(reservations.rows);
    expect(
      (await pool.query("SELECT * FROM waitlist_entries WHERE event_id = $1", [event.id])).rows,
    ).toEqual(queue.rows);
    expect(await openedAudits(event.id)).toEqual([
      {
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        entity_type: "EVENT",
        metadata: { closesAt: closesAt.toISOString() },
      },
    ]);
  });

  it("reopens a scheduled event whose closing date has passed", async () => {
    const event = await insertTestEvent(pool, { closesOffset: "-1 minute" });
    const closesAt = new Date((await repository.databaseTime()).getTime() + 3_600_000);

    const result = await repository.reopen(event.id, closesAt, adminId);

    expect(result).toMatchObject({ ok: true, value: { status: "SCHEDULED", closesAt } });
    expect(await openedAudits(event.id)).toHaveLength(1);
  });

  it.each([-60_000, 0, 30_000, 59_000])(
    "rejects a closing date %i ms from database time without changing the row",
    async (offset) => {
      const event = await insertTestEvent(pool, { status: "CLOSED", closesOffset: "-1 minute" });
      const before = await eventRow(event.id);
      const closesAt = new Date((await repository.databaseTime()).getTime() + offset);

      expect(await repository.reopen(event.id, closesAt, adminId)).toEqual({
        ok: false,
        error: "CLOSES_AT_IN_PAST",
      });
      expect(await eventRow(event.id)).toEqual(before);
      expect(await openedAudits(event.id)).toEqual([]);
    },
  );

  it("rejects a closing date after the dinner starts", async () => {
    const event = await insertTestEvent(pool, { status: "CLOSED", closesOffset: "-1 minute" });
    const before = await eventRow(event.id);
    const detail = await repository.getAdminEvent(event.id);
    const closesAt = new Date(detail.value!.startsAt.getTime() + 1);

    expect(await repository.reopen(event.id, closesAt, adminId)).toEqual({
      ok: false,
      error: "CLOSES_AFTER_START",
    });
    expect(await eventRow(event.id)).toEqual(before);
    expect(await openedAudits(event.id)).toEqual([]);
  });

  it("allows closing at the dinner start time", async () => {
    const event = await insertTestEvent(pool, { status: "CLOSED", closesOffset: "-1 minute" });
    const detail = await repository.getAdminEvent(event.id);
    const closesAt = detail.value!.startsAt;

    expect(await repository.reopen(event.id, closesAt, adminId)).toMatchObject({
      ok: true,
      value: { status: "SCHEDULED", closesAt },
    });
  });

  it.each(["COMPLETED", "CANCELLED", "DRAFT"] as const)(
    "rejects reopening from %s",
    async (status) => {
      const event = await insertTestEvent(pool, { status, closesOffset: "-1 minute" });
      const before = await eventRow(event.id);
      const closesAt = new Date((await repository.databaseTime()).getTime() + 3_600_000);

      expect(await repository.reopen(event.id, closesAt, adminId)).toEqual({
        ok: false,
        error: "INVALID_TRANSITION",
      });
      expect(await eventRow(event.id)).toEqual(before);
      expect(await openedAudits(event.id)).toEqual([]);
    },
  );

  it("returns EVENT_NOT_FOUND for a missing event", async () => {
    const closesAt = new Date((await repository.databaseTime()).getTime() + 3_600_000);

    expect(await repository.reopen(randomUUID(), closesAt, adminId)).toEqual({
      ok: false,
      error: "EVENT_NOT_FOUND",
    });
  });

  it("accepts a public reservation immediately after reopening", async () => {
    const event = await insertTestEvent(pool, { status: "CLOSED", closesOffset: "-1 minute" });
    const closesAt = new Date((await repository.databaseTime()).getTime() + 3_600_000);
    const reopened = await repository.reopen(event.id, closesAt, adminId);
    expect(reopened.ok).toBe(true);
    const submitReservation = createSubmitReservation({
      repository: new PostgresReservationAllocationRepository(pool),
      rateLimiter: allowAllRateLimiter,
      botVerifier: allowAllBotVerifier,
      computeFingerprint: requestFingerprint,
      generateLinkCode,
    });

    const result = await submitReservation({
      idempotencyKey: randomUUID(),
      body: reservationBody(event.slug),
      remoteIp: null,
      rateLimitSubject: "unknown",
    });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      status: "RECEIVED",
      request: { number: 1, partySize: 1 },
    });
    expect(await eventRow(event.id)).toMatchObject({ reserved_seats: 1 });
    expect(await openedAudits(event.id)).toHaveLength(1);
  });
});
