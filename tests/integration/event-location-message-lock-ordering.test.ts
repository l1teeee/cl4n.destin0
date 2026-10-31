import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  PostgresLocationMessageRepository,
  queueLocationMessage,
} from "@/infrastructure/db/repositories/postgres-location-message-repository";

import {
  insertAdminUser,
  insertGuestReservation,
  insertLocationEvent,
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
