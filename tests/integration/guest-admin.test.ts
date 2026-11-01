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
    maxPartySize?: 1 | 2;
    started?: boolean;
    status?: "DRAFT" | "SCHEDULED" | "CLOSED" | "COMPLETED" | "CANCELLED";
  } = {},
) {
  sequence += 1;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       internal_name, slug, starts_at, capacity, reserved_seats, max_party_size,
       opens_at, closes_at, waitlist_capacity, status
     )
     VALUES ($1, $2,
             CASE WHEN $8 THEN clock_timestamp() - interval '1 hour'
                  ELSE clock_timestamp() + interval '7 days' END,
             $3, $4, $7,
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
      input.maxPartySize ?? Math.min(2, input.capacity ?? 4),
      input.started ?? false,
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
      expectedStage: "PAID",
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
    const fullEventId = await insertEvent({ capacity: 2, maxPartySize: 2 });
    const single = await insertReservation(fullEventId, { name: "Dalia" });
    await insertReservation(fullEventId, { name: "Dalia Ocupa" });
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

  it("uses the stage seen by the admin when cancelling", async () => {
    const eventId = await insertEvent({ capacity: 3 });
    const acceptedReservation = await insertReservation(eventId, { name: "Etapa Lista" });
    expect(
      await acceptRequest(repository, {
        reservationId: acceptedReservation.id,
        actorAdminId: adminId,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await cancelRequest(repository, {
        reservationId: acceptedReservation.id,
        actorAdminId: adminId,
        sendMessage: false,
        expectedPromotedEntryIds: [],
        expectedStage: "ON_LIST",
      }),
    ).toMatchObject({ ok: true, refundPending: false });

    const onList = await insertReservation(eventId, { name: "Etapa Incorrecta", stage: "ON_LIST" });
    const before = await pool.query(
      "SELECT status, stage, refund_status, cancelled_at FROM reservations WHERE id = $1",
      [onList.id],
    );
    expect(
      await cancelRequest(repository, {
        reservationId: onList.id,
        actorAdminId: adminId,
        sendMessage: true,
        expectedPromotedEntryIds: [],
        expectedStage: "PAID",
      }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });
    const after = await pool.query(
      "SELECT status, stage, refund_status, cancelled_at FROM reservations WHERE id = $1",
      [onList.id],
    );
    expect(after.rows).toEqual(before.rows);
    expect(
      await pool.query("SELECT 1 FROM messages WHERE reservation_id = $1", [onList.id]),
    ).toHaveProperty("rowCount", 0);

    const paid = await insertReservation(eventId, { name: "Etapa Pagada", stage: "PAID" });
    expect(
      await cancelRequest(repository, {
        reservationId: paid.id,
        actorAdminId: adminId,
        sendMessage: false,
        expectedPromotedEntryIds: [],
        expectedStage: "PAID",
      }),
    ).toMatchObject({ ok: true, refundPending: true });
    await expect(
      pool.query("SELECT refund_status FROM reservations WHERE id = $1", [paid.id]),
    ).resolves.toMatchObject({ rows: [{ refund_status: "PENDING" }] });
    await invariant(eventId);
  });

  it("keeps previews and releases aligned when an event cannot promote", async () => {
    const cases = [
      { status: "CANCELLED" as const, started: false },
      { status: "COMPLETED" as const, started: false },
      { status: "DRAFT" as const, started: false },
      { status: "SCHEDULED" as const, started: true },
    ];

    for (const eventCase of cases) {
      const eventId = await insertEvent({ capacity: 2, ...eventCase });
      const review = await insertReservation(eventId, { name: `Rechazo ${eventCase.status}` });
      const waiting = await insertWaitlistEntry(eventId, { name: `Cola ${eventCase.status}` });
      const rejectPreview = await previewPromotion(eventId, pool);
      expect(rejectPreview).toEqual({ oneSeat: [], twoSeats: [] });
      expect(
        await rejectRequest(repository, {
          reservationId: review.id,
          actorAdminId: adminId,
          sendMessage: false,
          expectedPromotedEntryIds: rejectPreview.oneSeat.map((entry) => entry.id),
        }),
      ).toMatchObject({ ok: true, promoted: [] });

      const onList = await insertReservation(eventId, {
        name: `Cancelar ${eventCase.status}`,
        stage: "ON_LIST",
      });
      const cancelPreview = await previewPromotion(eventId, pool);
      expect(cancelPreview).toEqual({ oneSeat: [], twoSeats: [] });
      expect(
        await cancelRequest(repository, {
          reservationId: onList.id,
          actorAdminId: adminId,
          sendMessage: false,
          expectedPromotedEntryIds: cancelPreview.oneSeat.map((entry) => entry.id),
          expectedStage: "ON_LIST",
        }),
      ).toMatchObject({ ok: true, promoted: [] });
      await expect(
        pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [waiting.id]),
      ).resolves.toMatchObject({ rows: [{ status: "WAITING" }] });
      await invariant(eventId);
    }
  });

  it("skips duplicate queue heads in the preview and refuses to override-promote them", async () => {
    const eventId = await insertEvent({ capacity: 2 });
    const reservation = await insertReservation(eventId, { name: "Duplicada Activa" });
    const duplicate = await insertWaitlistEntry(eventId, { name: "Duplicada Cola", partySize: 2 });
    await pool.query("UPDATE waitlist_entries SET instagram_handle = $2 WHERE id = $1", [
      duplicate.id,
      reservation.fields.guest1Instagram,
    ]);
    const next = await insertWaitlistEntry(eventId, { name: "Siguiente Válida" });

    expect(await previewPromotion(eventId, pool)).toMatchObject({
      oneSeat: [{ id: next.id }],
      twoSeats: [{ id: next.id }],
    });
    // A general refusal without a field, because the admin did not type the handle.
    expect(
      await promoteEntry(repository, { entryId: duplicate.id, actorAdminId: adminId }),
    ).toEqual({ ok: false, code: "DUPLICATE_HANDLE" });
    await expect(
      pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [duplicate.id]),
    ).resolves.toMatchObject({ rows: [{ status: "WAITING" }] });
  });

  it("promotes after removing, editing, or moving the queue head", async () => {
    const removeEventId = await insertEvent({ capacity: 2 });
    await insertReservation(removeEventId, { name: "Ocupa Remover" });
    const oversizedHead = await insertWaitlistEntry(removeEventId, {
      name: "Cabeza Grande",
      partySize: 2,
    });
    const next = await insertWaitlistEntry(removeEventId, { name: "Cabeza Siguiente" });
    expect(
      await removeEntry(repository, {
        entryId: oversizedHead.id,
        actorAdminId: adminId,
        sendMessage: false,
      }),
    ).toMatchObject({ ok: true, promoted: [{ entryId: next.id }] });

    const updateEventId = await insertEvent({ capacity: 2 });
    await insertReservation(updateEventId, { name: "Ocupa Editar" });
    const editedHead = await insertWaitlistEntry(updateEventId, {
      name: "Cabeza Editable",
      partySize: 2,
    });
    expect(
      await updateEntry(repository, {
        entryId: editedHead.id,
        actorAdminId: adminId,
        fields: {
          ...editedHead.fields,
          partySize: 1,
          guest2Name: null,
          guest2Instagram: null,
        },
      }),
    ).toMatchObject({ ok: true, promoted: [{ entryId: editedHead.id }] });

    const moveEventId = await insertEvent({ capacity: 2 });
    await insertReservation(moveEventId, { name: "Ocupa Mover" });
    await insertWaitlistEntry(moveEventId, { name: "Cabeza Bloquea", partySize: 2 });
    const moved = await insertWaitlistEntry(moveEventId, { name: "Segunda Cabeza" });
    expect(
      await moveEntry(repository, {
        entryId: moved.id,
        actorAdminId: adminId,
        direction: "UP",
      }),
    ).toMatchObject({ ok: true, promoted: [{ entryId: moved.id }] });

    await invariant(removeEventId);
    await invariant(updateEventId);
    await invariant(moveEventId);
  });

  it("edits, overrides the oversized head, reorders and removes queue entries", async () => {
    const eventId = await insertEvent({ capacity: 3 });
    await insertReservation(eventId, { name: "Gina", partySize: 2 });
    const head = await insertWaitlistEntry(eventId, { name: "Hugo", partySize: 2 });
    const selected = await insertWaitlistEntry(eventId, { name: "Iris" });
    const third = await insertWaitlistEntry(eventId, { name: "Julia" });

    // One seat is free and the strict FIFO head needs two, so nobody is promoted.
    const editedFields = { ...selected.fields, notes: "Invitada por administración" };
    expect(
      await updateEntry(repository, {
        entryId: selected.id,
        actorAdminId: adminId,
        fields: editedFields,
      }),
    ).toMatchObject({ ok: true, guests: ["Iris"], promoted: [] });

    // The override skips the oversized head for the entry that fits.
    expect(
      await promoteEntry(repository, { entryId: selected.id, actorAdminId: adminId }),
    ).toMatchObject({ ok: true, promoted: [{ entryId: selected.id, guests: ["Iris"] }] });

    // The event is now full, so moving the next entry to the front promotes nobody.
    expect(
      await moveEntry(repository, { entryId: third.id, actorAdminId: adminId, direction: "UP" }),
    ).toMatchObject({ ok: true, promoted: [] });
    expect(
      await moveEntry(repository, { entryId: third.id, actorAdminId: adminId, direction: "UP" }),
    ).toEqual({ ok: false, code: "AT_EDGE" });
    expect(
      await moveEntry(repository, { entryId: selected.id, actorAdminId: adminId, direction: "UP" }),
    ).toEqual({ ok: false, code: "INVALID_STAGE" });

    expect(
      await removeEntry(repository, {
        entryId: third.id,
        actorAdminId: adminId,
        sendMessage: false,
      }),
    ).toMatchObject({ ok: true, messageIds: [], promoted: [] });
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
      idempotencyKey: randomUUID(),
    });
    expect(listed).toMatchObject({ ok: true, placement: "LIST", position: null, messageIds: [] });

    const queueEventId = await insertEvent({ capacity: 1 });
    await insertReservation(queueEventId, { name: "Luis" });
    const queued = await addRequest(repository, {
      eventId: queueEventId,
      actorAdminId: adminId,
      fields: guestFields("Marta"),
      idempotencyKey: randomUUID(),
    });
    expect(queued).toMatchObject({ ok: true, placement: "QUEUE", position: 1, messageIds: [] });

    await pool.query("UPDATE events SET waitlist_capacity = 1 WHERE id = $1", [queueEventId]);
    const noSpace = await addRequest(repository, {
      eventId: queueEventId,
      actorAdminId: adminId,
      fields: guestFields("Nora"),
      idempotencyKey: randomUUID(),
    });
    expect(noSpace).toEqual({ ok: false, code: "NO_SPACE" });

    const completedEventId = await insertEvent({ status: "COMPLETED" });
    expect(
      await addRequest(repository, {
        eventId: completedEventId,
        actorAdminId: adminId,
        fields: guestFields("Olga"),
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ ok: false, code: "EVENT_NOT_EDITABLE" });
    await invariant(listEventId);
    await invariant(queueEventId);
  });

  it("retries admin link codes across both tables without leaking unique violations", async () => {
    const occupiedEventId = await insertEvent({ capacity: 1 });
    const existingEntry = await insertWaitlistEntry(occupiedEventId, { name: "Código Existente" });
    await pool.query("UPDATE waitlist_entries SET link_code = 'ABC234' WHERE id = $1", [
      existingEntry.id,
    ]);
    const generated = ["ABC234", "DEF235"];
    const retryingRepository = new PostgresGuestAdminRepository(pool, () => generated.shift()!);
    const eventId = await insertEvent({ capacity: 1 });

    expect(
      await addRequest(retryingRepository, {
        eventId,
        actorAdminId: adminId,
        fields: guestFields("Código Nuevo"),
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({ ok: true, placement: "LIST" });
    await expect(
      pool.query("SELECT link_code FROM reservations WHERE event_id = $1", [eventId]),
    ).resolves.toMatchObject({ rows: [{ link_code: "DEF235" }] });

    const seatedEventId = await insertEvent({ capacity: 1 });
    const seated = await insertReservation(seatedEventId, { name: "Código Sentado" });
    await pool.query("UPDATE reservations SET link_code = 'GHJ345' WHERE id = $1", [seated.id]);
    const queueGenerated = ["GHJ345", "KLM346"];
    const queueRepository = new PostgresGuestAdminRepository(pool, () => queueGenerated.shift()!);
    expect(
      await addRequest(queueRepository, {
        eventId: seatedEventId,
        actorAdminId: adminId,
        fields: guestFields("Código Cola"),
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({ ok: true, placement: "QUEUE" });
    await expect(
      pool.query("SELECT link_code FROM waitlist_entries WHERE event_id = $1", [seatedEventId]),
    ).resolves.toMatchObject({ rows: [{ link_code: "KLM346" }] });

    const exhaustedRepository = new PostgresGuestAdminRepository(pool, () => "ABC234");
    const exhaustedEventId = await insertEvent({ capacity: 1 });
    expect(
      await addRequest(exhaustedRepository, {
        eventId: exhaustedEventId,
        actorAdminId: adminId,
        fields: guestFields("Código Agotado"),
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ ok: false, code: "TRY_AGAIN" });
    await expect(
      pool.query("SELECT reserved_seats, last_reservation_number FROM events WHERE id = $1", [
        exhaustedEventId,
      ]),
    ).resolves.toMatchObject({
      rows: [{ reserved_seats: 0, last_reservation_number: 0 }],
    });
  });

  it("enforces the event maximum party size on every admin edit path", async () => {
    const eventId = await insertEvent({ capacity: 2, maxPartySize: 1 });
    const couple = guestFields("Pareja Bloqueada", 2);
    expect(
      await addRequest(repository, {
        eventId,
        actorAdminId: adminId,
        fields: couple,
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ ok: false, code: "PARTY_SIZE_NOT_ALLOWED", maxPartySize: 1 });

    const reservation = await insertReservation(eventId, { name: "Editar Máximo" });
    expect(
      await updateRequest(repository, {
        reservationId: reservation.id,
        actorAdminId: adminId,
        fields: { ...couple, guest1Instagram: reservation.fields.guest1Instagram },
      }),
    ).toEqual({ ok: false, code: "PARTY_SIZE_NOT_ALLOWED", maxPartySize: 1 });

    const entry = await insertWaitlistEntry(eventId, { name: "Cola Máximo" });
    expect(
      await updateEntry(repository, {
        entryId: entry.id,
        actorAdminId: adminId,
        fields: { ...couple, guest1Instagram: entry.fields.guest1Instagram },
      }),
    ).toEqual({ ok: false, code: "PARTY_SIZE_NOT_ALLOWED", maxPartySize: 1 });
    await invariant(eventId);
  });

  it("refuses accept and payment verification on terminal or deleted events", async () => {
    for (const status of ["CANCELLED", "COMPLETED"] as const) {
      const eventId = await insertEvent({ capacity: 2, status });
      const review = await insertReservation(eventId, { name: `Aceptar ${status}` });
      const onList = await insertReservation(eventId, {
        name: `Pagar ${status}`,
        stage: "ON_LIST",
      });
      expect(
        await acceptRequest(repository, { reservationId: review.id, actorAdminId: adminId }),
      ).toEqual({ ok: false, code: "EVENT_NOT_EDITABLE" });
      expect(
        await verifyPayment(repository, {
          reservationId: onList.id,
          actorAdminId: adminId,
          paymentNote: null,
        }),
      ).toEqual({ ok: false, code: "EVENT_NOT_EDITABLE" });
    }

    const deletedEventId = await insertEvent({ capacity: 2 });
    const deletedReview = await insertReservation(deletedEventId, { name: "Aceptar Borrada" });
    await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [
      deletedEventId,
    ]);
    expect(
      await acceptRequest(repository, {
        reservationId: deletedReview.id,
        actorAdminId: adminId,
      }),
    ).toEqual({ ok: false, code: "EVENT_NOT_EDITABLE" });
  });

  it("attributes an admin override promotion to the admin without changing the request origin", async () => {
    const eventId = await insertEvent({ capacity: 1 });
    const entry = await insertWaitlistEntry(eventId, { name: "Promoción Manual" });

    const promoted = await promoteEntry(repository, { entryId: entry.id, actorAdminId: adminId });
    expect(promoted).toMatchObject({ ok: true });
    if (!promoted.ok) throw new Error("The override promotion must succeed");
    const reservationId = promoted.promoted[0]!.reservationId;

    await expect(
      pool.query(
        `SELECT r.source, r.created_by, m.source AS message_source, m.created_by AS message_creator
           FROM reservations r
           JOIN messages m ON m.reservation_id = r.id AND m.kind = 'PROMOTED'
          WHERE r.id = $1`,
        [reservationId],
      ),
    ).resolves.toMatchObject({
      rows: [
        { source: "PUBLIC", created_by: null, message_source: "ADMIN", message_creator: adminId },
      ],
    });
    await expect(
      pool.query(
        `SELECT actor_type, actor_admin_id
           FROM audit_logs
          WHERE action = 'WAITLIST_PROMOTED' AND entity_id = $1`,
        [reservationId],
      ),
    ).resolves.toMatchObject({ rows: [{ actor_type: "ADMIN", actor_admin_id: adminId }] });
    await invariant(eventId);
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
        expectedStage: "ON_LIST",
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
      expectedStage: "ON_LIST",
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
        guest1Instagram: review.fields.guest1Instagram,
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

  it("starts every admin transaction with the idle, lock and statement timeouts", async () => {
    const statements: string[] = [];
    const recordingPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (text: string, values?: unknown[]) => {
            statements.push(text);
            return client.query(text, values);
          },
          release: (error?: Error | boolean) => client.release(error),
        };
      },
    } as unknown as Pool;
    const eventId = await insertEvent({ capacity: 1 });
    const reservation = await insertReservation(eventId, { name: "Tiempos" });

    await acceptRequest(new PostgresGuestAdminRepository(recordingPool), {
      reservationId: reservation.id,
      actorAdminId: adminId,
    });

    expect(statements.slice(0, 4)).toEqual([
      "BEGIN ISOLATION LEVEL READ COMMITTED",
      "SET LOCAL idle_in_transaction_session_timeout = '5s'",
      "SET LOCAL lock_timeout = '3s'",
      "SET LOCAL statement_timeout = '5s'",
    ]);
  });

  it("reads one queue entry with its rank, and nothing for a mismatched kind or id", async () => {
    const eventId = await insertEvent({ capacity: 1 });
    await insertReservation(eventId, { name: "Ocupa Detalle" });
    const first = await insertWaitlistEntry(eventId, { name: "Primera Detalle" });
    const second = await insertWaitlistEntry(eventId, { name: "Segunda Detalle" });

    expect(await getGuestRequestDetail("WAITLIST_ENTRY", second.id, pool)).toMatchObject({
      kind: "WAITLIST_ENTRY",
      id: second.id,
      status: "WAITING",
      position: 2,
      timeline: [{ label: "Recibida", at: expect.any(Date) }],
      messages: [],
    });
    expect(await getGuestRequestDetail("RESERVATION", second.id, pool)).toBeNull();
    expect(await getGuestRequestDetail("WAITLIST_ENTRY", randomUUID(), pool)).toBeNull();

    await removeEntry(repository, { entryId: first.id, actorAdminId: adminId, sendMessage: false });
    expect(await getGuestRequestDetail("WAITLIST_ENTRY", second.id, pool)).toMatchObject({
      position: 1,
    });
    expect(await getGuestRequestDetail("WAITLIST_ENTRY", first.id, pool)).toMatchObject({
      status: "CANCELLED",
      position: null,
      timeline: [{ label: "Recibida" }, { label: "Cancelada" }],
    });
  });
});
