import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { listEventGuests } from "@/infrastructure/db/repositories/event-guest-queries";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import { PostgresPersonalDataRetentionRepository } from "@/infrastructure/db/repositories/postgres-personal-data-retention-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import { insertAdminUser, insertMessagingContact } from "../helpers/guest-flow-test-data";
import {
  allowAllBotVerifier,
  allowAllRateLimiter,
  insertTestEvent,
} from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let allocation: PostgresReservationAllocationRepository;
let admin: PostgresGuestAdminRepository;
let submitReservation: ReturnType<typeof createSubmitReservation>;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  allocation = new PostgresReservationAllocationRepository(pool);
  admin = new PostgresGuestAdminRepository(pool);
  adminId = await insertAdminUser(pool);
  submitReservation = createSubmitReservation({
    repository: allocation,
    rateLimiter: allowAllRateLimiter,
    botVerifier: allowAllBotVerifier,
    computeFingerprint: requestFingerprint,
    generateLinkCode,
  });
});

afterAll(async () => {
  await pool.end();
});

function group(prefix: string, size = 4) {
  return Array.from({ length: size }, (_, index) => ({
    name: `Invitado${index + 1} ${prefix}`,
    instagram: `${prefix}.${index + 1}`,
  }));
}

function submit(slug: string, guests: ReturnType<typeof group>, key = randomUUID()) {
  return submitReservation({
    idempotencyKey: key,
    body: {
      eventSlug: slug,
      guests,
      hasAllergies: false,
      acceptTerms: true,
      turnstileToken: "test-token",
    },
    remoteIp: null,
    rateLimitSubject: "group-test",
  });
}

async function companions(reservationId: string) {
  return (
    await pool.query(
      `SELECT slot, full_name, instagram_handle, contact_id FROM request_guests
      WHERE reservation_id = $1 ORDER BY slot`,
      [reservationId],
    )
  ).rows;
}

describe("groups on PostgreSQL", () => {
  it("allocates four guests atomically, replays once and exposes every guest in slot order", async () => {
    const event = await insertTestEvent(pool, { capacity: 4, maxPartySize: 4 });
    const guests = group("four");
    const key = randomUUID();
    const result = await submit(event.slug, guests, key);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ request: { partySize: 4 } });
    expect(await submit(event.slug, guests, key)).toMatchObject({
      body: result.body,
      replayed: true,
    });
    const rows = await pool.query("SELECT * FROM reservations WHERE event_id = $1", [event.id]);
    expect(rows.rows).toHaveLength(1);
    const reservation = rows.rows[0]!;
    expect(reservation).toMatchObject({
      full_name: guests[0]!.name,
      party_size: 4,
    });
    expect(await companions(reservation.id)).toEqual(
      guests.slice(1).map((guest, index) => ({
        slot: index + 2,
        full_name: guest.name,
        instagram_handle: guest.instagram,
        contact_id: null,
      })),
    );
    const view = await listEventGuests(event.id, "por-revisar", pool);
    expect(view[0]!.guests).toEqual(guests.map((guest, index) => ({ slot: index + 1, ...guest })));
    const eventState = await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [
      event.id,
    ]);
    expect(eventState.rows[0]!.reserved_seats).toBe(4);
  });

  it("rejects groups above the event maximum without a partial allocation", async () => {
    const event = await insertTestEvent(pool, { capacity: 8, maxPartySize: 3 });
    expect((await submit(event.slug, group("toobig"))).body).toMatchObject({
      error: { code: "PARTY_SIZE_NOT_ALLOWED" },
    });
    expect(
      (await pool.query("SELECT id FROM reservations WHERE event_id = $1", [event.id])).rows,
    ).toEqual([]);
    expect(
      (await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id])).rows[0]!
        .reserved_seats,
    ).toBe(0);
  });

  it("detects a third guest matching another request's companion", async () => {
    const event = await insertTestEvent(pool, { capacity: 12, maxPartySize: 4 });
    const existing = group("existing");
    expect((await submit(event.slug, existing)).status).toBe(201);
    const duplicate = group("duplicate");
    duplicate[2]!.instagram = existing[3]!.instagram.toUpperCase();
    expect((await submit(event.slug, duplicate)).body).toMatchObject({
      error: { code: "DUPLICATE_RESERVATION" },
    });
    expect(
      (await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id])).rows[0]!
        .reserved_seats,
    ).toBe(4);
  });

  it("copies all waiting companions and their contacts on promotion", async () => {
    const event = await insertTestEvent(pool, {
      capacity: 4,
      maxPartySize: 4,
      waitlistCapacity: 2,
    });
    expect((await submit(event.slug, group("seated"))).status).toBe(201);
    const waiting = group("waiting");
    expect((await submit(event.slug, waiting)).status).toBe(202);
    const entry = (
      await pool.query("SELECT id FROM waitlist_entries WHERE event_id = $1", [event.id])
    ).rows[0]!;
    const contacts: string[] = [];
    for (let slot = 2; slot <= 4; slot += 1) {
      const contactId = await insertMessagingContact(pool);
      contacts.push(contactId);
      await pool.query(
        "UPDATE request_guests SET contact_id = $3 WHERE waitlist_entry_id = $1 AND slot = $2",
        [entry.id, slot, contactId],
      );
    }
    const seated = (await pool.query("SELECT id FROM reservations WHERE event_id = $1", [event.id]))
      .rows[0]!;
    expect(
      await allocation.cancelReservation({ reservationId: seated.id, actorAdminId: adminId }),
    ).toBe("CANCELLED");
    const promoted = (
      await pool.query("SELECT id FROM reservations WHERE event_id = $1 AND status = 'CONFIRMED'", [
        event.id,
      ])
    ).rows[0]!;
    expect(await companions(promoted.id)).toEqual(
      waiting.slice(1).map((guest, index) => ({
        slot: index + 2,
        full_name: guest.name,
        instagram_handle: guest.instagram,
        contact_id: contacts[index],
      })),
    );
    const message = await pool.query(
      "SELECT body FROM messages WHERE reservation_id = $1 AND kind = 'PROMOTED'",
      [promoted.id],
    );
    expect(message.rows).toHaveLength(1);
    expect((await listEventGuests(event.id, "por-revisar", pool))[0]!.guests).toHaveLength(4);
  });

  it("preserves unchanged slot rows and contacts, resets changed handles and discards removed slots", async () => {
    const event = await insertTestEvent(pool, { capacity: 8, maxPartySize: 4 });
    const guests = group("editing");
    expect((await submit(event.slug, guests)).status).toBe(201);
    const reservation = (
      await pool.query("SELECT id FROM reservations WHERE event_id = $1", [event.id])
    ).rows[0]!;
    const contactId = await insertMessagingContact(pool);
    await pool.query("UPDATE request_guests SET contact_id = $2 WHERE reservation_id = $1", [
      reservation.id,
      contactId,
    ]);
    const before = await pool.query(
      "SELECT id FROM request_guests WHERE reservation_id = $1 AND slot = 2",
      [reservation.id],
    );
    await pool.query(
      `INSERT INTO messages (contact_id, reservation_id, event_id, guest_slot, direction, kind, source, status, body)
      SELECT $2, $1, $3, slot, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'QUEUED', 'Pendiente'
      FROM generate_series(2, 4) AS slot`,
      [reservation.id, contactId, event.id],
    );
    const fields = { guests, hasAllergies: false, allergies: null, notes: null };
    expect(
      await admin.update({ reservationId: reservation.id, actorAdminId: adminId, fields }),
    ).toMatchObject({ ok: true });
    expect((await companions(reservation.id))[0]!.contact_id).toBe(contactId);
    const updated = guests
      .slice(0, 2)
      .map((guest, index) => (index === 1 ? { ...guest, instagram: "editing.changed" } : guest));
    expect(
      await admin.update({
        reservationId: reservation.id,
        actorAdminId: adminId,
        fields: { ...fields, guests: updated },
      }),
    ).toMatchObject({ ok: true });
    expect(await companions(reservation.id)).toEqual([
      {
        slot: 2,
        full_name: guests[1]!.name,
        instagram_handle: "editing.changed",
        contact_id: null,
      },
    ]);
    expect(
      (
        await pool.query("SELECT id FROM request_guests WHERE reservation_id = $1 AND slot = 2", [
          reservation.id,
        ])
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await pool.query(
          "SELECT guest_slot, status, contact_id FROM messages WHERE reservation_id = $1 AND guest_slot > 1 ORDER BY guest_slot",
          [reservation.id],
        )
      ).rows,
    ).toEqual([
      { guest_slot: 2, status: "WAITING_CONTACT", contact_id: null },
      { guest_slot: 3, status: "DISCARDED", contact_id: contactId },
      { guest_slot: 4, status: "DISCARDED", contact_id: contactId },
    ]);
    expect(
      (await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id])).rows[0]!
        .reserved_seats,
    ).toBe(2);
  });

  it("purges an expired event's companion rows and linked companion contact", async () => {
    const event = await insertTestEvent(pool, { capacity: 4, maxPartySize: 4 });
    expect((await submit(event.slug, group("purged"))).status).toBe(201);
    const contactId = await insertMessagingContact(pool);
    await pool.query(
      `UPDATE request_guests SET contact_id = $2 WHERE reservation_id IN (
      SELECT id FROM reservations WHERE event_id = $1) AND slot = 3`,
      [event.id, contactId],
    );
    await pool.query(
      `UPDATE events SET opens_at = now() - interval '94 days',
      closes_at = now() - interval '93 days', starts_at = now() - interval '92 days' WHERE id = $1`,
      [event.id],
    );
    expect(await new PostgresPersonalDataRetentionRepository(pool).purgeEvent(event.id)).toBe(true);
    expect(
      (await pool.query("SELECT id FROM request_guests WHERE contact_id = $1", [contactId])).rows,
    ).toEqual([]);
    expect(
      (await pool.query("SELECT id FROM messaging_contacts WHERE id = $1", [contactId])).rows,
    ).toEqual([]);
    expect(
      (
        await pool.query(
          `SELECT g.id FROM request_guests g JOIN reservations r ON r.id = g.reservation_id
      WHERE r.event_id = $1`,
          [event.id],
        )
      ).rows,
    ).toEqual([]);
  });
});
