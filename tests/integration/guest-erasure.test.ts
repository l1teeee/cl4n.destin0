import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eraseGuestData } from "@/application/guests/guest-erasure";
import { pool as applicationPool } from "@/infrastructure/db/client";
import { PostgresGuestErasureRepository } from "@/infrastructure/db/repositories/guest-erasure";

import {
  configurePaymentSettings,
  insertAdminUser,
  insertGuestReservation,
  insertMessagingContact,
} from "../helpers/guest-flow-test-data";
import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresGuestErasureRepository;
let adminId: string;
let sequence = 0;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresGuestErasureRepository(pool);
  await configurePaymentSettings(pool);
  adminId = await insertAdminUser(pool);
});

afterAll(async () => {
  await pool.end();
  await applicationPool.end();
});

async function insertEvent(started = false): Promise<string> {
  const event = await insertTestEvent(pool, { capacity: 20 });
  if (started) {
    await pool.query(
      `UPDATE events
          SET starts_at = clock_timestamp() - interval '1 hour',
              opens_at = clock_timestamp() - interval '3 days',
              closes_at = clock_timestamp() - interval '2 days'
        WHERE id = $1`,
      [event.id],
    );
  }
  return event.id;
}

async function insertGroupGuest(
  reservationId: string,
  slot: number,
  contactId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO request_guests (reservation_id, slot, full_name, instagram_handle, contact_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [reservationId, slot, `Acompañante privado ${slot}`, `private.group.${slot}`, contactId],
  );
}

async function insertMessage(input: {
  reservationId?: string;
  waitlistEntryId?: string;
  contactId?: string;
  status?: string;
  lockedUntil?: string | null;
  withAttachment?: boolean;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messages (
       reservation_id, waitlist_entry_id, contact_id,
       direction, kind, source, status, body, locked_until
     ) VALUES ($1, $2, $3, 'OUTBOUND', 'FREE_TEXT', 'SYSTEM', $4, 'Mensaje privado',
               CASE WHEN $5::text IS NULL THEN NULL ELSE clock_timestamp() + $5::interval END)
     RETURNING id`,
    [
      input.reservationId ?? null,
      input.waitlistEntryId ?? null,
      input.contactId ?? null,
      input.status ?? "FAILED",
      input.lockedUntil ?? null,
    ],
  );
  const id = result.rows[0]!.id;
  if (input.withAttachment) {
    await pool.query(
      `INSERT INTO message_attachments (message_id, position, content_type, byte_size, data)
       VALUES ($1, 0, 'image/png', 1, $2)`,
      [id, Buffer.from([1])],
    );
  }
  return id;
}

async function insertWaitlistEntry(
  eventId: string,
  status: "WAITING" | "PROMOTED" | "CANCELLED",
  options: { promotedReservationId?: string; contactId?: string } = {},
): Promise<string> {
  sequence += 1;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, phone_e164, email, email_normalized,
       party_size, notes, allergies, terms_accepted_at, contact_id, contact_linked_by,
       idempotency_key, submitted_at, promoted_reservation_id, promoted_at, cancelled_at
     ) VALUES ($1, $2, $3, 'Nombre privado', $4, 'Acompañante privado', $5,
               '+50370000002', 'private.entry@example.com', 'private.entry@example.com',
               2, 'Observaciones privadas', 'Alergias privadas', now(),
               $6::uuid, CASE WHEN $6::uuid IS NULL THEN NULL ELSE 'MANUAL' END,
               $7, now(), $8::uuid,
               CASE WHEN $3 = 'PROMOTED' THEN now() ELSE NULL END,
               CASE WHEN $3 = 'CANCELLED' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      eventId,
      sequence,
      status,
      `private.entry.${sequence}`,
      `private.entry.${sequence}.b`,
      options.contactId ?? null,
      randomUUID(),
      options.promotedReservationId ?? null,
    ],
  );
  return result.rows[0]!.id;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const result = await pool.query<{ total: string }>(sql, params);
  return Number(result.rows[0]!.total);
}

async function reservationRow(id: string): Promise<Record<string, unknown>> {
  const result = await pool.query("SELECT * FROM reservations WHERE id = $1", [id]);
  return result.rows[0]!;
}

async function contactExists(id: string): Promise<boolean> {
  return (await count("SELECT count(*) AS total FROM messaging_contacts WHERE id = $1", [id])) > 0;
}

describe("guest data erasure", () => {
  it("anonymizes a cancelled group with its promoted-from entry and keeps seats, amounts and shared contacts", async () => {
    const eventId = await insertEvent();
    const titularContact = await insertMessagingContact(pool);
    const companionContact = await insertMessagingContact(pool);
    const sharedContact = await insertMessagingContact(pool);
    const reservationId = await insertGuestReservation(pool, eventId, {
      status: "CANCELLED",
      contactId: titularContact,
    });
    await pool.query(
      `UPDATE reservations
          SET party_size = 3, refund_status = 'PENDING', phone_e164 = '+50370000001',
              email = 'private@example.com', email_normalized = 'private@example.com',
              notes = 'Notas privadas', allergies = 'Alergias privadas',
              payment_note = 'Pago privado'
        WHERE id = $1`,
      [reservationId],
    );
    await insertGroupGuest(reservationId, 2, companionContact);
    await insertGroupGuest(reservationId, 3, sharedContact);
    const otherRequest = await insertGuestReservation(pool, eventId, { contactId: sharedContact });
    const entryId = await insertWaitlistEntry(eventId, "PROMOTED", {
      promotedReservationId: reservationId,
    });
    const messageId = await insertMessage({
      reservationId,
      contactId: titularContact,
      withAttachment: true,
    });
    await insertMessage({ waitlistEntryId: entryId, contactId: companionContact });
    const reservedSeats = await count("SELECT reserved_seats AS total FROM events WHERE id = $1", [
      eventId,
    ]);
    const before = await reservationRow(reservationId);
    const key = before.idempotency_key as string;
    await pool.query(
      `INSERT INTO idempotency_records (
         key, scope, request_fingerprint, response_status, response_body,
         reservation_id, completed_at
       ) VALUES ($1, 'reservation_submit', 'private-fingerprint', 200,
                 '{"linkCode":"SECRET"}', $2, now())`,
      [key, reservationId],
    );

    const result = await eraseGuestData(repository, { reservationId }, adminId);

    expect(result).toBe("ERASED");
    const after = await reservationRow(reservationId);
    expect(after).toMatchObject({
      full_name: "eliminado",
      guest2_full_name: null,
      guest2_instagram_handle: null,
      guest2_contact_id: null,
      phone_e164: null,
      email: null,
      email_normalized: null,
      notes: null,
      allergies: null,
      payment_note: null,
      link_code: null,
      contact_id: null,
      contact_linked_by: null,
      party_size: 3,
      refund_status: "PENDING",
      status: "CANCELLED",
      stage: before.stage,
    });
    expect(after.instagram_handle).toBe(`eliminado_${reservationId.slice(0, 8)}`);
    const entry = await pool.query("SELECT * FROM waitlist_entries WHERE id = $1", [entryId]);
    expect(entry.rows[0]).toMatchObject({
      full_name: "eliminado",
      guest2_full_name: null,
      phone_e164: null,
      email: null,
      notes: null,
      allergies: null,
      contact_id: null,
      status: "PROMOTED",
    });
    expect(
      await count("SELECT count(*) AS total FROM request_guests WHERE reservation_id = $1", [
        reservationId,
      ]),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) AS total FROM messages
          WHERE reservation_id = $1 OR waitlist_entry_id = $2`,
        [reservationId, entryId],
      ),
    ).toBe(0);
    expect(
      await count("SELECT count(*) AS total FROM message_attachments WHERE message_id = $1", [
        messageId,
      ]),
    ).toBe(0);
    expect(
      await count("SELECT count(*) AS total FROM idempotency_records WHERE key = $1", [key]),
    ).toBe(0);
    expect(await contactExists(titularContact)).toBe(false);
    expect(await contactExists(companionContact)).toBe(false);
    expect(await contactExists(sharedContact)).toBe(true);
    expect((await reservationRow(otherRequest)).contact_id).toBe(sharedContact);
    expect(await count("SELECT reserved_seats AS total FROM events WHERE id = $1", [eventId])).toBe(
      reservedSeats,
    );

    const audit = await pool.query<{ entity_id: string; action: string; metadata: unknown }>(
      `SELECT entity_id, action, metadata FROM audit_logs
        WHERE entity_id = ANY($1::uuid[]) AND metadata ? 'personalDataErased'`,
      [[reservationId, entryId]],
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual([
      "RESERVATION_UPDATED",
      "WAITLIST_UPDATED",
    ]);
    for (const row of audit.rows) {
      expect(row.metadata).toEqual({ personalDataErased: true });
    }
  });

  it("refuses an active reservation before the event and changes nothing", async () => {
    const eventId = await insertEvent();
    const reservationId = await insertGuestReservation(pool, eventId);
    const before = await reservationRow(reservationId);

    const result = await eraseGuestData(repository, { reservationId }, adminId);

    expect(result).toBe("ACTIVE");
    expect(await reservationRow(reservationId)).toEqual(before);
  });

  it("erases a confirmed reservation once the event has started", async () => {
    const eventId = await insertEvent(true);
    const reservationId = await insertGuestReservation(pool, eventId);

    const result = await eraseGuestData(repository, { reservationId }, adminId);

    expect(result).toBe("ERASED");
    expect((await reservationRow(reservationId)).full_name).toBe("eliminado");
    expect((await reservationRow(reservationId)).status).toBe("CONFIRMED");
  });

  it("answers ALREADY_ERASED on the second call", async () => {
    const eventId = await insertEvent();
    const reservationId = await insertGuestReservation(pool, eventId, { status: "CANCELLED" });

    expect(await eraseGuestData(repository, { reservationId }, adminId)).toBe("ERASED");
    expect(await eraseGuestData(repository, { reservationId }, adminId)).toBe("ALREADY_ERASED");
  });

  it("answers NOT_FOUND for an unknown request", async () => {
    expect(await eraseGuestData(repository, { reservationId: randomUUID() }, adminId)).toBe(
      "NOT_FOUND",
    );
    expect(await eraseGuestData(repository, { waitlistEntryId: randomUUID() }, adminId)).toBe(
      "NOT_FOUND",
    );
  });

  it("refuses while a message is leased for delivery and changes nothing", async () => {
    const eventId = await insertEvent();
    const contactId = await insertMessagingContact(pool);
    const reservationId = await insertGuestReservation(pool, eventId, {
      status: "CANCELLED",
      contactId,
    });
    const messageId = await insertMessage({
      reservationId,
      contactId,
      status: "QUEUED",
      lockedUntil: "1 minute",
    });
    const before = await reservationRow(reservationId);

    const result = await eraseGuestData(repository, { reservationId }, adminId);

    expect(result).toBe("LIVE_LEASE");
    expect(await reservationRow(reservationId)).toEqual(before);
    expect(await count("SELECT count(*) AS total FROM messages WHERE id = $1", [messageId])).toBe(
      1,
    );
    expect(await contactExists(contactId)).toBe(true);
  });

  it("erases a cancelled waitlist entry", async () => {
    const eventId = await insertEvent();
    const contactId = await insertMessagingContact(pool);
    const entryId = await insertWaitlistEntry(eventId, "CANCELLED", { contactId });

    const result = await eraseGuestData(repository, { waitlistEntryId: entryId }, adminId);

    expect(result).toBe("ERASED");
    const entry = await pool.query("SELECT * FROM waitlist_entries WHERE id = $1", [entryId]);
    expect(entry.rows[0]).toMatchObject({
      full_name: "eliminado",
      guest2_full_name: null,
      email: null,
      contact_id: null,
      status: "CANCELLED",
    });
    expect(await contactExists(contactId)).toBe(false);
  });

  it("refuses a waiting entry before the event", async () => {
    const eventId = await insertEvent();
    const entryId = await insertWaitlistEntry(eventId, "WAITING");

    expect(await eraseGuestData(repository, { waitlistEntryId: entryId }, adminId)).toBe("ACTIVE");
  });
});
