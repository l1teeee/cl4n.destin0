import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverMessagesNow } from "@/application/messaging/deliver-messages";
import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import {
  PostgresLocationMessageRepository,
  queueLocationMessage,
} from "@/infrastructure/db/repositories/postgres-location-message-repository";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

import {
  insertAdminUser,
  insertGuestReservation,
  insertLocationEvent,
  insertMessagingContact,
  listLocationMessages,
  openEventLock,
  waitUntilSomeoneIsBlocked,
} from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresLocationMessageRepository;
let adminId: string;

beforeEach(async () => {
  await pool?.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString(), max: 10 });
  repository = new PostgresLocationMessageRepository(pool);
  adminId = await insertAdminUser(pool);
});

afterAll(async () => {
  await pool.end();
});

function sendBoundTo(eventId: string, revision: number) {
  return repository.sendLocationToPaidGuests(eventId, { revision, status: "CONFIRMED" }, adminId);
}

async function waitUntilBlocked(count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'`,
    );
    if (waiting.rows[0]!.count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Fewer than ${count} backends became blocked on the event row lock`);
}

function verify(reservationId: string) {
  return new PostgresGuestAdminRepository(pool).verifyPayment({
    reservationId,
    actorAdminId: adminId,
    paymentNote: null,
  });
}

function fakeMessenger(): InstagramMessenger {
  return {
    sendText: vi.fn(async () => ({ messageId: `meta-${randomUUID()}` })),
    sendImage: vi.fn(async () => ({ messageId: `meta-${randomUUID()}` })),
    fetchProfile: vi.fn(async () => ({ username: null, name: null })),
    downloadImage: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
}

async function messageKindsOf(reservationId: string): Promise<string[]> {
  const result = await pool.query<{ kind: string }>(
    "SELECT kind FROM messages WHERE reservation_id = $1 ORDER BY created_at, id",
    [reservationId],
  );
  return result.rows.map((row) => row.kind);
}

describe("payment verification queues the location in its own transaction", () => {
  it("enqueues PAID then LOCATION for the contact and delivers both after the commit", async () => {
    const eventId = await insertLocationEvent(pool);
    const contactId = await insertMessagingContact(pool);
    const reservationId = await insertGuestReservation(pool, eventId, {
      stage: "ON_LIST",
      contactId,
    });

    const result = await verify(reservationId);

    if (!result.ok) throw new Error(result.code);
    expect(result.messageIds).toHaveLength(2);
    expect(await messageKindsOf(reservationId)).toEqual(["PAID", "LOCATION"]);
    const [location] = await listLocationMessages(pool, eventId);
    expect(location).toMatchObject({
      id: result.messageIds[1],
      source: "SYSTEM",
      status: "QUEUED",
    });

    const messenger = fakeMessenger();
    const summary = await deliverMessagesNow(
      {
        repository: new PostgresMessageRepository(pool),
        messenger,
        now: Date.now,
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      result.messageIds,
      { timeBudgetMs: 5_000 },
    );

    expect(summary.sent).toBe(2);
    const texts = vi.mocked(messenger.sendText).mock.calls.map((call) => call[1]);
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe(location!.body);
  });

  it("enqueues only PAID while the location is still pending", async () => {
    const eventId = await insertLocationEvent(pool, { confirmed: false });
    const reservationId = await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });

    const result = await verify(reservationId);

    if (!result.ok) throw new Error(result.code);
    expect(result.messageIds).toHaveLength(1);
    expect(await messageKindsOf(reservationId)).toEqual(["PAID"]);
  });

  it("commits the payment and queues only PAID when the location does not fit in one message", async () => {
    const eventId = await insertLocationEvent(pool, {
      notes: "n".repeat(1000),
      mapsUrl: `https://maps.google.com/?q=${"a".repeat(1100)}`,
    });
    const reservationId = await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });

    const result = await verify(reservationId);

    if (!result.ok) throw new Error(result.code);
    expect(result.messageIds).toHaveLength(1);
    expect(await messageKindsOf(reservationId)).toEqual(["PAID"]);
    const stage = await pool.query<{ stage: string }>(
      "SELECT stage FROM reservations WHERE id = $1",
      [reservationId],
    );
    expect(stage.rows[0]!.stage).toBe("PAID");
  });

  it("queues the new revision when a location edit commits before the payment", async () => {
    const eventId = await insertLocationEvent(pool);
    const reservationId = await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });

    const holder = await openEventLock(pool, eventId);
    await holder.query(
      `UPDATE events
          SET location_notes = 'Puerta azul', location_revision = location_revision + 1
        WHERE id = $1`,
      [eventId],
    );
    const paying = verify(reservationId);
    await waitUntilBlocked(1);
    await holder.query("COMMIT");
    holder.release();

    expect((await paying).ok).toBe(true);
    const rows = await listLocationMessages(pool, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ location_revision: 1 });
    expect(rows[0]!.body).toContain("Puerta azul");
    expect(rows[0]!.body).not.toContain("Toca el timbre");
  });

  it("serializes a payment queued first and a bulk send, and queues the location once", async () => {
    const eventId = await insertLocationEvent(pool);
    const alreadyPaid = await insertGuestReservation(pool, eventId);
    const paying = await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });

    const holder = await openEventLock(pool, eventId);
    const payment = verify(paying);
    await waitUntilBlocked(1);
    const send = sendBoundTo(eventId, 0);
    await waitUntilBlocked(2);
    await holder.query("COMMIT");
    holder.release();

    expect((await payment).ok).toBe(true);
    const result = await send;
    expect(result.ok && result.messageIds).toHaveLength(1);
    const rows = await listLocationMessages(pool, eventId);
    expect(rows.map((row) => row.reservation_id).sort()).toEqual([alreadyPaid, paying].sort());
    expect(rows.find((row) => row.reservation_id === paying)).toMatchObject({ source: "SYSTEM" });
    expect(rows.find((row) => row.reservation_id === alreadyPaid)).toMatchObject({
      source: "ADMIN",
    });
  });

  it("serializes a bulk send queued first and a payment, and queues the location once", async () => {
    const eventId = await insertLocationEvent(pool);
    const alreadyPaid = await insertGuestReservation(pool, eventId);
    const paying = await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });

    const holder = await openEventLock(pool, eventId);
    const send = sendBoundTo(eventId, 0);
    await waitUntilBlocked(1);
    const payment = verify(paying);
    await waitUntilBlocked(2);
    await holder.query("COMMIT");
    holder.release();

    const result = await send;
    expect(result.ok && result.messageIds).toHaveLength(1);
    expect((await payment).ok).toBe(true);
    const rows = await listLocationMessages(pool, eventId);
    expect(rows.map((row) => row.reservation_id).sort()).toEqual([alreadyPaid, paying].sort());
    expect(rows.find((row) => row.reservation_id === alreadyPaid)).toMatchObject({
      source: "ADMIN",
    });
    expect(rows.find((row) => row.reservation_id === paying)).toMatchObject({ source: "SYSTEM" });
  });
});

describe("location delivery ordering behind the event row lock", () => {
  it("includes a guest whose payment commits before the bulk send runs", async () => {
    const eventId = await insertLocationEvent(pool);
    const earlierGuest = await insertGuestReservation(pool, eventId);

    const holder = await openEventLock(pool, eventId);
    const lateGuest = await insertGuestReservation(holder, eventId);
    const send = sendBoundTo(eventId, 0);
    await waitUntilSomeoneIsBlocked(pool);
    await holder.query("COMMIT");
    holder.release();

    const result = await send;
    expect(result.ok && result.messageIds).toHaveLength(2);
    const rows = await listLocationMessages(pool, eventId);
    expect(rows.map((row) => row.reservation_id).sort()).toEqual([earlierGuest, lateGuest].sort());
  });

  it("does not queue for a guest whose cancellation commits first", async () => {
    const eventId = await insertLocationEvent(pool);
    const keptGuest = await insertGuestReservation(pool, eventId);
    const cancelledGuest = await insertGuestReservation(pool, eventId);

    const holder = await openEventLock(pool, eventId);
    await holder.query(
      `UPDATE reservations
          SET status = 'CANCELLED', cancelled_at = clock_timestamp(), release_reason = 'CANCELLED',
              refund_status = 'PENDING'
        WHERE id = $1`,
      [cancelledGuest],
    );
    await holder.query("UPDATE events SET reserved_seats = reserved_seats - 1 WHERE id = $1", [
      eventId,
    ]);
    const send = sendBoundTo(eventId, 0);
    await waitUntilSomeoneIsBlocked(pool);
    await holder.query("COMMIT");
    holder.release();

    expect((await send).ok).toBe(true);
    const rows = await listLocationMessages(pool, eventId);
    expect(rows.map((row) => row.reservation_id)).toEqual([keptGuest]);
  });

  it("refuses the old revision when a location edit commits first and queues the new one afterwards", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId);

    const holder = await openEventLock(pool, eventId);
    await holder.query(
      `UPDATE events
          SET location_notes = 'Puerta azul', location_revision = location_revision + 1
        WHERE id = $1`,
      [eventId],
    );
    const staleSend = sendBoundTo(eventId, 0);
    await waitUntilSomeoneIsBlocked(pool);
    await holder.query("COMMIT");
    holder.release();

    await expect(staleSend).resolves.toEqual({ ok: false, error: "LOCATION_CHANGED" });
    expect(await listLocationMessages(pool, eventId)).toEqual([]);

    await expect(sendBoundTo(eventId, 1)).resolves.toMatchObject({ ok: true });
    const rows = await listLocationMessages(pool, eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ location_revision: 1 });
    expect(rows[0]!.body).toContain("Puerta azul");
    expect(rows[0]!.body).not.toContain("Toca el timbre");
  });

  it("waits behind a payment that already queued the location and does not duplicate it", async () => {
    const eventId = await insertLocationEvent(pool);
    const paying = await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });
    const alreadyPaid = await insertGuestReservation(pool, eventId);

    const holder = await openEventLock(pool, eventId);
    await holder.query(
      "UPDATE reservations SET stage = 'PAID', paid_at = clock_timestamp() WHERE id = $1",
      [paying],
    );
    const queued = await queueLocationMessage(holder, eventId, paying);
    expect(queued.outcome).toBe("QUEUED");
    const send = sendBoundTo(eventId, 0);
    await waitUntilSomeoneIsBlocked(pool);
    await holder.query("COMMIT");
    holder.release();

    const result = await send;
    expect(result.ok && result.messageIds).toHaveLength(1);
    const rows = await listLocationMessages(pool, eventId);
    expect(rows.map((row) => row.reservation_id).sort()).toEqual([paying, alreadyPaid].sort());
  });

  it("returns TRY_AGAIN when the event row stays locked past the lock timeout", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId);

    const holder = await openEventLock(pool, eventId);
    try {
      await expect(sendBoundTo(eventId, 0)).resolves.toEqual({ ok: false, error: "TRY_AGAIN" });
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }

    expect(await listLocationMessages(pool, eventId)).toEqual([]);
    await expect(sendBoundTo(eventId, 0)).resolves.toMatchObject({ ok: true });
    expect(await listLocationMessages(pool, eventId)).toHaveLength(1);
  }, 20_000);
});
