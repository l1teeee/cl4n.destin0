import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GuestFields } from "@/application/guests/guest-admin-repository";
import {
  acceptRequest,
  addRequest,
  cancelRequest,
  markRefunded,
  moveEntry,
  promoteEntry,
  rejectRequest,
  removeEntry,
  updateEntry,
  updateRequest,
  verifyPayment,
} from "@/application/guests/guest-admin-use-cases";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import {
  countEventGuests,
  getGuestRequestDetail,
  listEventGuests,
  previewPromotion,
} from "@/infrastructure/db/repositories/event-guest-queries";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresGuestAdminRepository;
let adminId: string;
let sequence = 0;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresGuestAdminRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('guest-admin@example.com', 'guest-admin@example.com', 'hash', 'Guest Admin')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

function guestFields(name: string, partySize: 1 | 2 = 1): GuestFields {
  const handle = name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return {
    partySize,
    guest1Name: name,
    guest1Instagram: `${handle}${sequence}`,
    guest2Name: partySize === 2 ? `${name} Dos` : null,
    guest2Instagram: partySize === 2 ? `${handle}${sequence}.dos` : null,
    hasAllergies: false,
    allergies: null,
    notes: null,
  };
}

async function insertEvent(
  input: {
    capacity?: number;
    reservedSeats?: number;
    waitlistCapacity?: number;
    status?: "DRAFT" | "SCHEDULED" | "CLOSED" | "COMPLETED" | "CANCELLED";
  } = {},
) {
  sequence += 1;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       internal_name, slug, starts_at, capacity, reserved_seats, max_party_size,
       opens_at, closes_at, waitlist_capacity, status
     )
     VALUES ($1, $2, clock_timestamp() + interval '7 days', $3, $4, LEAST(2, $3),
             clock_timestamp() - interval '1 day', clock_timestamp() + interval '6 days',
             $5, $6)
     RETURNING id`,
    [
      `Evento ${sequence}`,
      `guest-admin-${sequence}`,
      input.capacity ?? 4,
      input.reservedSeats ?? 0,
      input.waitlistCapacity ?? 5,
      input.status ?? "SCHEDULED",
    ],
  );
  return result.rows[0]!.id;
}

async function insertReservation(
  eventId: string,
  input: {
    name: string;
    partySize?: 1 | 2;
    stage?: "IN_REVIEW" | "ON_LIST" | "PAID";
    countSeats?: boolean;
  },
) {
  const partySize = input.partySize ?? 1;
  const stage = input.stage ?? "IN_REVIEW";
  const number = await pool.query<{ last_reservation_number: number }>(
    `UPDATE events
        SET reserved_seats = reserved_seats + CASE WHEN $2 THEN $3 ELSE 0 END,
            last_reservation_number = last_reservation_number + 1
      WHERE id = $1
      RETURNING last_reservation_number`,
    [eventId, input.countSeats ?? true, partySize],
  );
  const fields = guestFields(input.name, partySize);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, stage, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, party_size, terms_accepted_at,
       link_code, idempotency_key, submitted_at, accepted_at, on_list_at, paid_at
     )
     VALUES ($1, $2, 'CONFIRMED', $3, $4, $5, $6, $7, $8, now(), $9, $10, now(), now(),
             CASE WHEN $3 IN ('ON_LIST', 'PAID') THEN now() END,
             CASE WHEN $3 = 'PAID' THEN now() END)
     RETURNING id`,
    [
      eventId,
      number.rows[0]!.last_reservation_number,
      stage,
      fields.guest1Name,
      fields.guest1Instagram,
      fields.guest2Name,
      fields.guest2Instagram,
      partySize,
      generateLinkCode(),
      randomUUID(),
    ],
  );
  return { id: result.rows[0]!.id, fields };
}

async function insertWaitlistEntry(
  eventId: string,
  input: { name: string; partySize?: 1 | 2; status?: "WAITING" | "CANCELLED" },
) {
  const partySize = input.partySize ?? 1;
  const status = input.status ?? "WAITING";
  const number = await pool.query<{ last_waitlist_number: number }>(
    `UPDATE events
        SET waitlisted_count = waitlisted_count + CASE WHEN $2 = 'WAITING' THEN 1 ELSE 0 END,
            last_waitlist_number = last_waitlist_number + 1
      WHERE id = $1
      RETURNING last_waitlist_number`,
    [eventId, status],
  );
  const fields = guestFields(input.name, partySize);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, party_size, terms_accepted_at,
       link_code, idempotency_key, submitted_at, cancelled_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, now(),
             CASE WHEN $3 = 'CANCELLED' THEN now() END)
     RETURNING id`,
    [
      eventId,
      number.rows[0]!.last_waitlist_number,
      status,
      fields.guest1Name,
      fields.guest1Instagram,
      fields.guest2Name,
      fields.guest2Instagram,
      partySize,
      generateLinkCode(),
      randomUUID(),
    ],
  );
  return { id: result.rows[0]!.id, fields };
}

async function invariant(eventId: string) {
  const result = await pool.query<{
    reserved_seats: number;
    confirmed_seats: number;
    waitlisted_count: number;
    waiting_rows: number;
  }>(
    `SELECT e.reserved_seats,
            COALESCE((SELECT SUM(party_size)::int FROM reservations
                       WHERE event_id = e.id AND status = 'CONFIRMED'), 0) AS confirmed_seats,
            e.waitlisted_count,
            (SELECT COUNT(*)::int FROM waitlist_entries
              WHERE event_id = e.id AND status = 'WAITING') AS waiting_rows
       FROM events e
      WHERE e.id = $1`,
    [eventId],
  );
  expect(result.rows[0]).toMatchObject({
    reserved_seats: result.rows[0]!.confirmed_seats,
    waitlisted_count: result.rows[0]!.waiting_rows,
  });
}

describe("guest admin use cases", () => {
  it("accepts, verifies payment, cancels paid, and marks refunded with audited messages", async () => {
    const eventId = await insertEvent({ capacity: 2 });
    const reservation = await insertReservation(eventId, { name: "Ana" });

    const accepted = await acceptRequest(repository, {
      reservationId: reservation.id,
      actorAdminId: adminId,
    });
    expect(accepted).toMatchObject({ ok: true, guests: ["Ana"], promoted: [] });
    expect(
      await acceptRequest(repository, { reservationId: reservation.id, actorAdminId: adminId }),
    ).toEqual({
      ok: false,
      code: "INVALID_STAGE",
    });

    const paid = await verifyPayment(repository, {
      reservationId: reservation.id,
      actorAdminId: adminId,
      paymentNote: "Transferencia verificada",
    });
    expect(paid).toMatchObject({ ok: true, guests: ["Ana"] });

    const cancelled = await cancelRequest(repository, {
      reservationId: reservation.id,
      actorAdminId: adminId,
      sendMessage: false,
      expectedPromotedEntryIds: [],
    });
    expect(cancelled).toMatchObject({ ok: true, refundPending: true, messageIds: [] });

    const refunded = await markRefunded(repository, {
      reservationId: reservation.id,
      actorAdminId: adminId,
      sendMessage: true,
    });
    expect(refunded).toMatchObject({ ok: true, guests: ["Ana"] });
    const stored = await pool.query(
      `SELECT status, stage, payment_note, refund_status, refunded_at
         FROM reservations WHERE id = $1`,
      [reservation.id],
    );
    expect(stored.rows[0]).toMatchObject({
      status: "CANCELLED",
      stage: "PAID",
      payment_note: "Transferencia verificada",
      refund_status: "REFUNDED",
      refunded_at: expect.any(Date),
    });
    const messages = await pool.query<{ kind: string; status: string; body: string }>(
      "SELECT kind, status, body FROM messages WHERE reservation_id = $1 ORDER BY created_at",
      [reservation.id],
    );
    expect(messages.rows).toMatchObject([
      { kind: "ON_LIST", status: "WAITING_CONTACT", body: expect.any(String) },
      { kind: "PAID", status: "WAITING_CONTACT", body: expect.any(String) },
      { kind: "REFUNDED", status: "WAITING_CONTACT", body: expect.any(String) },
    ]);
    await invariant(eventId);
  });

  it("rolls back a reject when the expected queue changed, then promotes the exact head", async () => {
    const eventId = await insertEvent({ capacity: 1 });
    const reservation = await insertReservation(eventId, { name: "Bruno" });
    const waiting = await insertWaitlistEntry(eventId, { name: "Carla" });

    const stale = await rejectRequest(repository, {
      reservationId: reservation.id,
      actorAdminId: adminId,
      sendMessage: true,
      expectedPromotedEntryIds: [],
    });
    expect(stale).toEqual({ ok: false, code: "WAITLIST_CHANGED" });
    expect(
      (await pool.query("SELECT status FROM reservations WHERE id = $1", [reservation.id])).rows[0]!
        .status,
    ).toBe("CONFIRMED");
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE reservation_id = $1", [reservation.id]))
        .rowCount,
    ).toBe(0);

    const rejected = await rejectRequest(repository, {
      reservationId: reservation.id,
      actorAdminId: adminId,
      sendMessage: true,
      expectedPromotedEntryIds: [waiting.id],
    });
    expect(rejected).toMatchObject({
      ok: true,
      guests: ["Bruno"],
      promoted: [{ entryId: waiting.id, guests: ["Carla"] }],
    });
    const kinds = await pool.query<{ kind: string }>(
      "SELECT kind FROM messages WHERE event_id = $1 ORDER BY created_at, id",
      [eventId],
    );
    expect(kinds.rows.map((row) => row.kind).sort()).toEqual(["PROMOTED", "REJECTED"]);
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE action = 'RESERVATION_REJECTED' AND entity_id = $1",
      [reservation.id],
    );
    const serialized = JSON.stringify(audit.rows[0]!.metadata);
    expect(serialized).not.toContain("Bruno");
    expect(serialized).not.toContain(reservation.fields.guest1Instagram);
    expect(audit.rows[0]!.metadata).toMatchObject({ partySize: 1, promotedCount: 1 });
    await invariant(eventId);
  });

  it("guards growth, detects duplicate handles, and promotes after a shrink", async () => {
    const fullEventId = await insertEvent({ capacity: 1 });
    const single = await insertReservation(fullEventId, { name: "Dalia" });
    const couple = {
      ...single.fields,
      partySize: 2 as const,
      guest2Name: "Dalia Dos",
      guest2Instagram: "dalia.dos",
    };
    expect(
      await updateRequest(repository, {
        reservationId: single.id,
        actorAdminId: adminId,
        fields: couple,
      }),
    ).toEqual({ ok: false, code: "NO_SEAT" });

    const eventId = await insertEvent({ capacity: 2 });
    const reservation = await insertReservation(eventId, {
      name: "Elena",
      partySize: 2,
    });
    const waiting = await insertWaitlistEntry(eventId, { name: "Fabio" });
    const duplicateFields = {
      ...reservation.fields,
      guest1Instagram: waiting.fields.guest1Instagram,
    };
    expect(
      await updateRequest(repository, {
        reservationId: reservation.id,
        actorAdminId: adminId,
        fields: duplicateFields,
      }),
    ).toMatchObject({ ok: false, code: "DUPLICATE_HANDLE", field: "guest1Instagram" });

    const shrunk = await updateRequest(repository, {
      reservationId: reservation.id,
      actorAdminId: adminId,
      fields: {
        ...reservation.fields,
        partySize: 1,
        guest2Name: null,
        guest2Instagram: null,
      },
    });
    expect(shrunk).toMatchObject({
      ok: true,
      promoted: [{ entryId: waiting.id, guests: ["Fabio"] }],
    });
    await invariant(eventId);
  });

  it("edits, reorders, promotes a specific queue entry, and removes without a message", async () => {
    const eventId = await insertEvent({ capacity: 2 });
    await insertReservation(eventId, { name: "Gina" });
    const head = await insertWaitlistEntry(eventId, { name: "Hugo", partySize: 2 });
    const selected = await insertWaitlistEntry(eventId, { name: "Iris" });
    const third = await insertWaitlistEntry(eventId, { name: "Julia" });

    const editedFields = { ...selected.fields, notes: "Invitada por administración" };
    expect(
      await updateEntry(repository, {
        entryId: selected.id,
        actorAdminId: adminId,
        fields: editedFields,
      }),
    ).toMatchObject({ ok: true, guests: ["Iris"] });
    expect(
      await moveEntry(repository, {
        entryId: selected.id,
        actorAdminId: adminId,
        direction: "UP",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await moveEntry(repository, {
        entryId: selected.id,
        actorAdminId: adminId,
        direction: "UP",
      }),
    ).toEqual({ ok: false, code: "AT_EDGE" });

    const promoted = await promoteEntry(repository, {
      entryId: selected.id,
      actorAdminId: adminId,
    });
    expect(promoted).toMatchObject({
      ok: true,
      promoted: [{ entryId: selected.id, guests: ["Iris"] }],
    });
    expect(
      await removeEntry(repository, {
        entryId: third.id,
        actorAdminId: adminId,
        sendMessage: false,
      }),
    ).toMatchObject({ ok: true, messageIds: [] });
    expect(await promoteEntry(repository, { entryId: head.id, actorAdminId: adminId })).toEqual({
      ok: false,
      code: "NO_SEAT",
    });
    await invariant(eventId);
  });

  it("adds an admin request to seats, queue, or refuses it when both are full", async () => {
    const listEventId = await insertEvent({ capacity: 2 });
    const listFields = guestFields("Karla", 2);
    const listed = await addRequest(repository, {
      eventId: listEventId,
      actorAdminId: adminId,
      fields: listFields,
      linkCode: generateLinkCode(),
      idempotencyKey: randomUUID(),
    });
    expect(listed).toMatchObject({ ok: true, placement: "LIST", position: null, messageIds: [] });

    const queueEventId = await insertEvent({ capacity: 1 });
    await insertReservation(queueEventId, { name: "Luis" });
    const queued = await addRequest(repository, {
      eventId: queueEventId,
      actorAdminId: adminId,
      fields: guestFields("Marta"),
      linkCode: generateLinkCode(),
      idempotencyKey: randomUUID(),
    });
    expect(queued).toMatchObject({ ok: true, placement: "QUEUE", position: 1, messageIds: [] });

    await pool.query("UPDATE events SET waitlist_capacity = 1 WHERE id = $1", [queueEventId]);
    const noSpace = await addRequest(repository, {
      eventId: queueEventId,
      actorAdminId: adminId,
      fields: guestFields("Nora"),
      linkCode: generateLinkCode(),
      idempotencyKey: randomUUID(),
    });
    expect(noSpace).toEqual({ ok: false, code: "NO_SPACE" });

    const completedEventId = await insertEvent({ status: "COMPLETED" });
    expect(
      await addRequest(repository, {
        eventId: completedEventId,
        actorAdminId: adminId,
        fields: guestFields("Olga"),
        linkCode: generateLinkCode(),
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ ok: false, code: "EVENT_NOT_EDITABLE" });
    await invariant(listEventId);
    await invariant(queueEventId);
  });

  it("refuses invalid stages and keeps cancelled reservation edits out of seat math", async () => {
    const eventId = await insertEvent({ capacity: 4 });
    const review = await insertReservation(eventId, { name: "Olivia" });
    const onList = await insertReservation(eventId, { name: "Pedro", stage: "ON_LIST" });
    const paid = await insertReservation(eventId, { name: "Renata", stage: "PAID" });
    const cancelledEntry = await insertWaitlistEntry(eventId, {
      name: "Sofía",
      status: "CANCELLED",
    });

    expect(
      await verifyPayment(repository, {
        reservationId: review.id,
        actorAdminId: adminId,
        paymentNote: null,
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    expect(
      await rejectRequest(repository, {
        reservationId: onList.id,
        actorAdminId: adminId,
        sendMessage: false,
        expectedPromotedEntryIds: [],
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    expect(
      await cancelRequest(repository, {
        reservationId: review.id,
        actorAdminId: adminId,
        sendMessage: false,
        expectedPromotedEntryIds: [],
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    expect(
      await acceptRequest(repository, { reservationId: paid.id, actorAdminId: adminId }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    expect(
      await markRefunded(repository, {
        reservationId: paid.id,
        actorAdminId: adminId,
        sendMessage: false,
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });

    const cancelled = await cancelRequest(repository, {
      reservationId: onList.id,
      actorAdminId: adminId,
      sendMessage: true,
      expectedPromotedEntryIds: [],
    });
    expect(cancelled).toMatchObject({ ok: true, refundPending: false });
    const cancelledMessage = await pool.query<{ kind: string; status: string; body: string }>(
      "SELECT kind, status, body FROM messages WHERE reservation_id = $1",
      [onList.id],
    );
    expect(cancelledMessage.rows).toMatchObject([
      { kind: "CANCELLED_UNPAID", status: "WAITING_CONTACT", body: expect.any(String) },
    ]);

    const seatsBeforeEdit = await pool.query<{ reserved_seats: number }>(
      "SELECT reserved_seats FROM events WHERE id = $1",
      [eventId],
    );
    const editedCancelled = await updateRequest(repository, {
      reservationId: onList.id,
      actorAdminId: adminId,
      fields: {
        ...onList.fields,
        partySize: 2,
        guest2Name: "Pedro Dos",
        guest2Instagram: `${onList.fields.guest1Instagram}.dos`,
      },
    });
    expect(editedCancelled).toMatchObject({ ok: true, promoted: [] });
    const seatsAfterEdit = await pool.query<{ reserved_seats: number }>(
      "SELECT reserved_seats FROM events WHERE id = $1",
      [eventId],
    );
    expect(seatsAfterEdit.rows[0]!.reserved_seats).toBe(seatsBeforeEdit.rows[0]!.reserved_seats);

    expect(
      await updateEntry(repository, {
        entryId: cancelledEntry.id,
        actorAdminId: adminId,
        fields: cancelledEntry.fields,
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    expect(
      await moveEntry(repository, {
        entryId: cancelledEntry.id,
        actorAdminId: adminId,
        direction: "UP",
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    expect(
      await promoteEntry(repository, { entryId: cancelledEntry.id, actorAdminId: adminId }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    expect(
      await removeEntry(repository, {
        entryId: cancelledEntry.id,
        actorAdminId: adminId,
        sendMessage: true,
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });

    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE metadata ->> 'eventId' = $1",
      [eventId],
    );
    const serializedAudit = JSON.stringify(audit.rows.map((row) => row.metadata));
    expect(serializedAudit).not.toContain("Olivia");
    expect(serializedAudit).not.toContain("Pedro Dos");
    expect(serializedAudit).not.toContain(onList.fields.guest1Instagram);
    await invariant(eventId);
  });

  it("returns staged views, counts, promotion previews, messages, and timeline detail", async () => {
    const eventId = await insertEvent({ capacity: 3 });
    const review = await insertReservation(eventId, { name: "Pablo" });
    const onList = await insertReservation(eventId, { name: "Queta", stage: "ON_LIST" });
    const paid = await insertReservation(eventId, { name: "Rosa", stage: "PAID" });
    await pool.query(
      `UPDATE reservations
          SET status = 'CANCELLED', release_reason = 'CANCELLED', cancelled_at = now()
        WHERE id = $1`,
      [onList.id],
    );
    await pool.query("UPDATE events SET reserved_seats = reserved_seats - 1 WHERE id = $1", [
      eventId,
    ]);
    const waiting = await insertWaitlistEntry(eventId, { name: "Sara", partySize: 2 });
    await insertWaitlistEntry(eventId, { name: "Tania" });

    await acceptRequest(repository, { reservationId: review.id, actorAdminId: adminId });
    const views = await Promise.all([
      listEventGuests(eventId, "en-la-lista", pool),
      listEventGuests(eventId, "confirmados", pool),
      listEventGuests(eventId, "cola", pool),
      listEventGuests(eventId, "descartados", pool),
    ]);
    expect(views.map((rows) => rows.length)).toEqual([1, 1, 2, 1]);
    expect(views[0]![0]!.lastMessage).toMatchObject({ kind: "ON_LIST", status: "WAITING_CONTACT" });

    const counts = await countEventGuests(eventId, pool);
    expect(counts).toMatchObject({
      occupiedSeats: 2,
      capacity: 3,
      waitlisted: 2,
      counts: { "en-la-lista": 1, confirmados: 1, cola: 2, descartados: 1, todas: 5 },
      pendingMessages: 1,
    });
    const preview = await previewPromotion(eventId, pool);
    expect(preview.oneSeat).toEqual([{ id: waiting.id, guests: ["Sara", "Sara Dos"] }]);
    expect(preview.twoSeats).toHaveLength(2);

    const detail = await getGuestRequestDetail("RESERVATION", review.id, pool);
    expect(detail).toMatchObject({
      id: review.id,
      timeline: [
        { label: "Recibida", at: expect.any(Date) },
        { label: "En la lista", at: expect.any(Date) },
      ],
      messages: [{ kind: "ON_LIST", status: "WAITING_CONTACT" }],
    });
    expect(paid.id).toBeTruthy();
    await invariant(eventId);
  });
});
