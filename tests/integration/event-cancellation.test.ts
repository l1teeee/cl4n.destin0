import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";

import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresEventRepository;
let guests: PostgresGuestAdminRepository;
let adminId: string;
let sequence = 0;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventRepository(pool);
  guests = new PostgresGuestAdminRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('event-cancel@example.com', 'event-cancel@example.com', 'hash', 'Event Cancel')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

async function addRequest(eventId: string, partySize: 1 | 2 = 1) {
  sequence += 1;
  const idempotencyKey = randomUUID();
  const result = await guests.addRequest({
    eventId,
    actorAdminId: adminId,
    idempotencyKey,
    fields: {
      guests: [
        { name: `Invitado ${sequence}`, instagram: `event.cancel.${sequence}` },
        ...(partySize === 2
          ? [{ name: `Acompañante ${sequence}`, instagram: `event.cancel.${sequence}.dos` }]
          : []),
      ],
      hasAllergies: false,
      allergies: null,
      notes: null,
    },
  });
  if (!result.ok) throw new Error(result.code);
  const request = await pool.query<{ id: string }>(
    `SELECT id FROM reservations WHERE idempotency_key = $1
     UNION ALL
     SELECT id FROM waitlist_entries WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return request.rows[0]!.id;
}

async function setStage(id: string, stage: "ON_LIST" | "PAID") {
  await pool.query(
    `UPDATE reservations
        SET stage = $2, on_list_at = clock_timestamp(),
            paid_at = CASE WHEN $2 = 'PAID' THEN clock_timestamp() END
      WHERE id = $1`,
    [id, stage],
  );
}

describe("event cancellation", () => {
  it("cancels every active stage and queue entry, marks paid refunds and queues one DM per request", async () => {
    const event = await insertTestEvent(pool, { capacity: 5, waitlistCapacity: 2 });
    const inReview = await addRequest(event.id);
    const onList = await addRequest(event.id, 2);
    const paid = await addRequest(event.id, 2);
    await setStage(onList, "ON_LIST");
    await setStage(paid, "PAID");
    const queueOne = await addRequest(event.id);
    const queueTwo = await addRequest(event.id, 2);

    const result = await repository.cancel(event.id, adminId);

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: event.id,
        status: "CANCELLED",
        reservedSeats: 0,
        waitlistedCount: 0,
        cancelledReservations: 3,
        refundsPending: 1,
        cancelledEntries: 2,
      },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.messageIds).toHaveLength(5);
    expect(new Set(result.value.messageIds).size).toBe(5);
    const reservations = await pool.query(
      `SELECT id, status, stage, refund_status, release_reason, cancelled_at
         FROM reservations WHERE event_id = $1`,
      [event.id],
    );
    expect(reservations.rows).toHaveLength(3);
    for (const row of reservations.rows) {
      expect(row).toMatchObject({
        status: "CANCELLED",
        refund_status: row.id === paid ? "PENDING" : null,
        release_reason: "CANCELLED",
        cancelled_at: expect.any(Date),
      });
    }
    const entries = await pool.query(
      "SELECT status, cancelled_at, promoted_reservation_id FROM waitlist_entries WHERE event_id = $1",
      [event.id],
    );
    expect(entries.rows).toHaveLength(2);
    for (const row of entries.rows) {
      expect(row).toEqual({
        status: "CANCELLED",
        cancelled_at: expect.any(Date),
        promoted_reservation_id: null,
      });
    }
    const messages = await pool.query(
      `SELECT id, kind, reservation_id, waitlist_entry_id, source, created_by, body
         FROM messages WHERE event_id = $1`,
      [event.id],
    );
    expect(messages.rows).toHaveLength(5);
    expect(messages.rows.map((row) => row.id).sort()).toEqual(result.value.messageIds.sort());
    const subjects = [
      { reservation_id: inReview, waitlist_entry_id: null, kind: "CANCELLED_UNPAID" },
      { reservation_id: onList, waitlist_entry_id: null, kind: "CANCELLED_UNPAID" },
      { reservation_id: paid, waitlist_entry_id: null, kind: "CANCELLED_PAID" },
      { reservation_id: null, waitlist_entry_id: queueOne, kind: "CANCELLED_UNPAID" },
      { reservation_id: null, waitlist_entry_id: queueTwo, kind: "CANCELLED_UNPAID" },
    ];
    for (const subject of subjects) {
      expect(messages.rows).toContainEqual(
        expect.objectContaining({
          ...subject,
          source: "ADMIN",
          created_by: adminId,
          body: expect.any(String),
        }),
      );
    }
    const audits = await pool.query(
      `SELECT actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         FROM audit_logs
        WHERE entity_id = $1 OR metadata->>'eventId' = $1::text`,
      [event.id],
    );
    for (const [id, stage, partySize] of [
      [inReview, "IN_REVIEW", 1],
      [onList, "ON_LIST", 2],
      [paid, "PAID", 2],
    ]) {
      expect(audits.rows).toContainEqual({
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        action: "RESERVATION_CANCELLED",
        entity_type: "RESERVATION",
        entity_id: id,
        metadata: {
          eventId: event.id,
          stage,
          partySize,
          refundPending: stage === "PAID",
          reason: "EVENT_CANCELLED",
        },
      });
    }
    for (const id of [queueOne, queueTwo]) {
      expect(audits.rows).toContainEqual({
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        action: "WAITLIST_CANCELLED",
        entity_type: "WAITLIST_ENTRY",
        entity_id: id,
        metadata: { eventId: event.id, reason: "EVENT_CANCELLED" },
      });
    }
    expect(audits.rows.filter((row) => row.action === "EVENT_UPDATED")).toEqual([
      {
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        action: "EVENT_UPDATED",
        entity_type: "EVENT",
        entity_id: event.id,
        metadata: {
          changedFields: ["status"],
          before: { status: "SCHEDULED" },
          after: { status: "CANCELLED" },
          cancelledReservations: 3,
          refundsPending: 1,
          cancelledEntries: 2,
        },
      },
    ]);
    const storedEvent = await pool.query(
      "SELECT status, reserved_seats, waitlisted_count FROM events WHERE id = $1",
      [event.id],
    );
    expect(storedEvent.rows).toEqual([
      { status: "CANCELLED", reserved_seats: 0, waitlisted_count: 0 },
    ]);
  });

  it.each(["DRAFT", "SCHEDULED", "CLOSED"] as const)(
    "still cancels an empty %s event",
    async (status) => {
      const event = await insertTestEvent(pool, { status });
      expect(await repository.cancel(event.id, adminId)).toMatchObject({
        ok: true,
        value: {
          status: "CANCELLED",
          cancelledReservations: 0,
          refundsPending: 0,
          cancelledEntries: 0,
          messageIds: [],
        },
      });
    },
  );

  it.each(["COMPLETED", "CANCELLED"] as const)(
    "preserves the forbidden transition from %s without changing requests",
    async (status) => {
      const event = await insertTestEvent(pool);
      const reservationId = await addRequest(event.id);
      await pool.query("UPDATE events SET status = $2 WHERE id = $1", [event.id, status]);
      expect(await repository.cancel(event.id, adminId)).toEqual({
        ok: false,
        error: "INVALID_TRANSITION",
      });
      const reservation = await pool.query("SELECT * FROM reservations WHERE id = $1", [
        reservationId,
      ]);
      expect(reservation.rows[0]).toMatchObject({ status: "CONFIRMED", cancelled_at: null });
      const messages = await pool.query("SELECT id FROM messages WHERE event_id = $1", [event.id]);
      expect(messages.rows).toEqual([]);
    },
  );

  it("leaves already cancelled and refunded reservations untouched", async () => {
    const event = await insertTestEvent(pool);
    const reservationId = await addRequest(event.id);
    await setStage(reservationId, "PAID");
    const cancelled = await guests.cancel({
      reservationId,
      actorAdminId: adminId,
      expectedStage: "PAID",
      sendMessage: false,
      replacement: { mode: "auto", expectedPromotedEntryIds: [] },
    });
    expect(cancelled.ok).toBe(true);
    const refunded = await guests.markRefunded({
      reservationId,
      actorAdminId: adminId,
      sendMessage: false,
    });
    expect(refunded.ok).toBe(true);
    const before = await pool.query("SELECT * FROM reservations WHERE id = $1", [reservationId]);

    expect(await repository.cancel(event.id, adminId)).toMatchObject({
      ok: true,
      value: { cancelledReservations: 0, refundsPending: 0, messageIds: [] },
    });

    const after = await pool.query("SELECT * FROM reservations WHERE id = $1", [reservationId]);
    expect(after.rows).toEqual(before.rows);
    expect(after.rows[0]).toMatchObject({ status: "CANCELLED", refund_status: "REFUNDED" });
    const audits = await pool.query(
      "SELECT id FROM audit_logs WHERE entity_id = $1 AND action = 'RESERVATION_CANCELLED'",
      [reservationId],
    );
    expect(audits.rows).toHaveLength(1);
  });
});
