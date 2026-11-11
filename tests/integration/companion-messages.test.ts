import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { GuestFields } from "@/application/guests/guest-admin-repository";
import { deliverMessagesNow } from "@/application/messaging/deliver-messages";
import { ingestInstagramEvents } from "@/application/messaging/ingest-instagram-events";
import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import { PostgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import {
  PostgresLocationMessageRepository,
  queueLocationMessage,
} from "@/infrastructure/db/repositories/postgres-location-message-repository";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

import {
  inEventLock,
  insertAdminUser,
  insertGuestReservation,
  insertLocationEvent,
  insertMessagingContact,
} from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let messages: PostgresMessageRepository;
let clues: PostgresEventClueRepository;
let locations: PostgresLocationMessageRepository;
let adminId: string;
const version = { revision: 0, status: "CONFIRMED" as const };

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  messages = new PostgresMessageRepository(pool);
  clues = new PostgresEventClueRepository(pool);
  locations = new PostgresLocationMessageRepository(pool);
  adminId = await insertAdminUser(pool);
});

afterAll(async () => {
  await pool.end();
});

function messenger(username: string | null = null): InstagramMessenger {
  return {
    sendText: vi.fn(async () => ({ messageId: randomUUID() })),
    sendImage: vi.fn(async () => ({ messageId: randomUUID() })),
    fetchProfile: vi.fn(async () => ({ username, name: null })),
    downloadImage: vi.fn(async () => {
      throw new Error("No images expected");
    }),
  };
}

async function couple(options: { companionContact?: boolean; primaryContact?: boolean } = {}) {
  const eventId = await insertLocationEvent(pool);
  const primaryId = options.primaryContact === false ? null : await insertMessagingContact(pool);
  const companionId = options.companionContact ? await insertMessagingContact(pool) : null;
  const reservationId = await insertGuestReservation(pool, eventId, {
    contactId: primaryId,
    fullName: "Ana López",
    guest2FullName: "Luis Pérez",
  });
  const reservation = await pool.query<{
    instagram_handle: string;
    guest2_instagram_handle: string;
  }>(
    `UPDATE reservations SET guest2_contact_id = $2 WHERE id = $1
     RETURNING instagram_handle, guest2_instagram_handle`,
    [reservationId, companionId],
  );
  return { eventId, reservationId, primaryId, companionId, ...reservation.rows[0]! };
}

async function clue(eventId: string) {
  const result = await clues.add({ eventId, body: "Busca la puerta azul.", actorId: adminId });
  if (!result.ok) throw new Error(result.error);
  return { eventId, clueId: result.value.id, actorId: adminId };
}

async function rows(reservationId: string) {
  const result = await pool.query<{
    id: string;
    guest_slot: 1 | 2;
    contact_id: string | null;
    status: string;
    kind: string;
  }>(
    "SELECT id, guest_slot, contact_id, status, kind FROM messages WHERE reservation_id = $1 ORDER BY kind, guest_slot",
    [reservationId],
  );
  return result.rows;
}

async function writeAs(username: string) {
  const scopedId = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 24)}`).toString();
  const result = await ingestInstagramEvents(
    { repository: messages, messenger: messenger(username), deliver: vi.fn(), logFailure: vi.fn() },
    [
      {
        type: "inbound_message",
        senderId: scopedId,
        externalMessageId: randomUUID(),
        timestamp: new Date(),
        text: "Hola",
        attachmentUrls: [],
        imageAttachmentUrls: [],
        quickReplyPayload: null,
        referralRef: null,
      },
    ],
    { ownAccountId: null },
  );
  await result.after();
  const contact = await pool.query<{ id: string }>(
    "SELECT id FROM messaging_contacts WHERE instagram_scoped_id = $1",
    [scopedId],
  );
  return contact.rows[0]!.id;
}

describe("clues and companion conversations", () => {
  it("queues one clue per person, delivers to each contact and queues no repeats", async () => {
    const fixture = await couple({ companionContact: true });
    const input = await clue(fixture.eventId);
    const sent = await clues.sendToAll(input);
    if (!sent.ok) throw new Error(sent.error);
    expect(sent.messageIds).toHaveLength(2);
    expect(await rows(fixture.reservationId)).toMatchObject([
      { guest_slot: 1, contact_id: fixture.primaryId, status: "QUEUED" },
      { guest_slot: 2, contact_id: fixture.companionId, status: "QUEUED" },
    ]);
    expect(await clues.sendToAll(input)).toEqual({ ok: true, messageIds: [] });
    expect(
      await clues.sendToPerson({ ...input, reservationId: fixture.reservationId, slot: 2 }),
    ).toEqual({ ok: true, messageIds: [] });
    const transport = messenger();
    const delivery = await deliverMessagesNow(
      {
        repository: messages,
        messenger: transport,
        now: Date.now,
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      sent.messageIds,
      { timeBudgetMs: 5_000 },
    );
    expect(delivery.sent).toBe(2);
    const contacts = await pool.query<{ instagram_scoped_id: string }>(
      "SELECT instagram_scoped_id FROM messaging_contacts WHERE id = ANY($1::uuid[])",
      [[fixture.primaryId, fixture.companionId]],
    );
    expect(
      vi
        .mocked(transport.sendText)
        .mock.calls.map((call) => call[0])
        .sort(),
    ).toEqual(contacts.rows.map((contact) => contact.instagram_scoped_id).sort());
    expect((await clues.getDeliveryForEvent(fixture.eventId))[input.clueId]).toEqual({
      paid: 2,
      received: 2,
      pending: 0,
      failed: 0,
    });
  });

  it("waits for the companion and links only their slot when they write", async () => {
    const fixture = await couple();
    await clues.sendToAll(await clue(fixture.eventId));
    await locations.sendLocationToPaidGuests(fixture.eventId, version, adminId);
    expect((await rows(fixture.reservationId)).filter((row) => row.guest_slot === 2)).toMatchObject(
      [
        { status: "WAITING_CONTACT", contact_id: null },
        { status: "WAITING_CONTACT", contact_id: null },
      ],
    );
    const unsent = await messages.listUnsentMessages(100);
    const companionMessage = (await rows(fixture.reservationId)).find(
      (row) => row.guest_slot === 2,
    )!;
    expect(unsent.find((row) => row.id === companionMessage.id)).toMatchObject({
      instagramUsername: fixture.guest2_instagram_handle,
      guestName: "Luis Pérez",
      contactId: null,
    });
    const companionId = await writeAs(fixture.guest2_instagram_handle);
    const queued = await rows(fixture.reservationId);
    expect(queued.filter((row) => row.guest_slot === 2)).toMatchObject([
      { status: "QUEUED", contact_id: companionId },
      { status: "QUEUED", contact_id: companionId },
    ]);
    expect(
      queued
        .filter((row) => row.guest_slot === 1)
        .every((row) => row.contact_id === fixture.primaryId),
    ).toBe(true);
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE action = 'MESSAGING_CONTACT_LINKED' AND entity_id = $1",
      [fixture.reservationId],
    );
    expect(audit.rows).toContainEqual({
      metadata: expect.objectContaining({
        method: "USERNAME",
        companion: true,
        contactId: companionId,
      }),
    });
    const conversation = await messages.getConversation(companionId);
    expect(conversation?.linkedRequests).toContainEqual(
      expect.objectContaining({ id: fixture.reservationId, role: "COMPANION" }),
    );
    const unlinked = await messages.listConversations({
      page: 1,
      pageSize: 100,
      unlinkedOnly: true,
    });
    expect(unlinked.items.map((item) => item.contactId)).not.toContain(companionId);
    const requestMessages = await messages.getRequestMessagesForMany({
      reservationIds: [fixture.reservationId],
      waitlistEntryIds: [],
    });
    expect(requestMessages.byReservationId.get(fixture.reservationId)).toHaveLength(4);
  });

  it("titular username, manual and code links never take the companion's messages", async () => {
    const fixture = await couple({ primaryContact: false });
    const input = await clue(fixture.eventId);
    await clues.sendToAll(input);
    const primaryId = await writeAs(fixture.instagram_handle);
    expect(
      await messages.linkContact(primaryId, { reservationId: fixture.reservationId }, adminId),
    ).toBe(true);
    await pool.query("UPDATE reservations SET link_code = 'AB23CD' WHERE id = $1", [
      fixture.reservationId,
    ]);
    await messages.linkContactByCode(primaryId, "AB23CD", adminId);
    expect(await rows(fixture.reservationId)).toMatchObject([
      { guest_slot: 1, status: "QUEUED", contact_id: primaryId },
      { guest_slot: 2, status: "WAITING_CONTACT", contact_id: null },
    ]);
    expect(await messages.repairWaitingContacts()).toBe(0);
  });

  it("does not link ambiguous companion usernames or a contact already linked as titular", async () => {
    const first = await couple();
    const second = await couple();
    await pool.query("UPDATE reservations SET guest2_instagram_handle = $2 WHERE id = $1", [
      second.reservationId,
      first.guest2_instagram_handle,
    ]);
    await clues.sendToAll(await clue(first.eventId));
    await clues.sendToAll(await clue(second.eventId));
    await writeAs(first.guest2_instagram_handle);
    expect((await rows(first.reservationId))[1]).toMatchObject({
      status: "WAITING_CONTACT",
      contact_id: null,
    });
    expect((await rows(second.reservationId))[1]).toMatchObject({
      status: "WAITING_CONTACT",
      contact_id: null,
    });
    const titular = await couple();
    expect(await messages.linkByUsername(titular.primaryId!, titular.guest2_instagram_handle)).toBe(
      false,
    );
  });

  it("unlinks a companion without touching the titular and repairs, retries and claims their own contact", async () => {
    const fixture = await couple({ companionContact: true });
    await clues.sendToAll(await clue(fixture.eventId));
    const companion = (await rows(fixture.reservationId))[1]!;
    await pool.query("UPDATE messages SET contact_id = $2 WHERE id = $1", [
      companion.id,
      fixture.primaryId,
    ]);
    const [claim] = await messages.claimDue(1, [companion.id]);
    expect(claim).toMatchObject({ id: companion.id, contactId: fixture.companionId });
    expect(
      await messages.unlinkContact(
        fixture.companionId!,
        { reservationId: fixture.reservationId },
        adminId,
      ),
    ).toBe("LIVE_LEASE");
    await messages.markFailed(claim!.id, claim!.lockedUntil, "RETRY");
    expect(await messages.retryMessage(companion.id)).toBe("UPDATED");
    expect(
      await messages.unlinkContact(
        fixture.companionId!,
        { reservationId: fixture.reservationId },
        adminId,
      ),
    ).toBe("UPDATED");
    expect(await rows(fixture.reservationId)).toMatchObject([
      { guest_slot: 1, status: "QUEUED", contact_id: fixture.primaryId },
      { guest_slot: 2, status: "WAITING_CONTACT", contact_id: null },
    ]);
    await pool.query("UPDATE reservations SET guest2_contact_id = $2 WHERE id = $1", [
      fixture.reservationId,
      fixture.companionId,
    ]);
    expect(await messages.repairWaitingContacts()).toBe(1);
    expect((await rows(fixture.reservationId))[1]).toMatchObject({
      status: "QUEUED",
      contact_id: fixture.companionId,
    });
  });

  it("rejects sending a clue to a missing companion", async () => {
    const eventId = await insertLocationEvent(pool);
    const reservationId = await insertGuestReservation(pool, eventId);
    expect(await clues.sendToPerson({ ...(await clue(eventId)), reservationId, slot: 2 })).toEqual({
      ok: false,
      error: "GUEST_NOT_ELIGIBLE",
    });
  });
});

interface CompanionEditMessage {
  id: string;
  guest_slot: 1 | 2;
  status: string;
  contact_id: string | null;
  handled_by: string | null;
  locked_until: Date | null;
  parts_sent: number;
  external_part_ids: string[] | null;
  attempts: number;
  claims_without_progress: number;
  last_error: string | null;
  location_revision: number;
}

async function editMessages(reservationId: string): Promise<CompanionEditMessage[]> {
  const result = await pool.query<CompanionEditMessage>(
    "SELECT * FROM messages WHERE reservation_id = $1 ORDER BY guest_slot, location_revision",
    [reservationId],
  );
  return result.rows;
}

async function seedEditMessages(
  fixture: Awaited<ReturnType<typeof couple>>,
  liveLease: boolean,
): Promise<CompanionEditMessage[]> {
  await pool.query(
    `INSERT INTO messages (
       reservation_id, event_id, contact_id, guest_slot, direction, kind, source,
       status, body, location_revision, sent_at, read_at, locked_until,
       parts_sent, external_part_ids, attempts, claims_without_progress, last_error
     )
     SELECT $1, $2,
            CASE WHEN person.slot = 2 AND item.status = 'WAITING_CONTACT' THEN NULL
                 ELSE person.contact_id END,
            person.slot, 'OUTBOUND', 'LOCATION', 'ADMIN',
            CASE WHEN person.slot = 1 THEN 'QUEUED' ELSE item.status END,
            'Ubicación de prueba', item.position::integer,
            CASE WHEN person.slot = 2 AND item.status IN ('SENT', 'READ', 'SENT_MANUALLY')
                 THEN clock_timestamp() END,
            CASE WHEN person.slot = 2 AND item.status = 'READ' THEN clock_timestamp() END,
            CASE WHEN person.slot = 2 AND item.position = 5 AND $5::boolean
                   THEN clock_timestamp() + interval '10 minutes'
                 WHEN person.slot = 2 AND item.position = 3
                   THEN clock_timestamp() - interval '1 minute' END,
            1, ARRAY['old-part'], 3, 2, 'OLD_ERROR'
       FROM unnest($6::text[]) WITH ORDINALITY AS item(status, position)
       CROSS JOIN (VALUES (1, $3::uuid), (2, $4::uuid)) person(slot, contact_id)`,
    [
      fixture.reservationId,
      fixture.eventId,
      fixture.primaryId,
      fixture.companionId,
      liveLease,
      [
        "WAITING_CONTACT",
        "WAITING_WINDOW",
        "QUEUED",
        "FAILED",
        "QUEUED",
        "SENT",
        "READ",
        "SENT_MANUALLY",
        "DISCARDED",
      ],
    ],
  );
  return editMessages(fixture.reservationId);
}

function editCompanion(
  fixture: Awaited<ReturnType<typeof couple>>,
  fields: Partial<GuestFields> & {
    partySize?: number;
    guest2Name?: string | null;
    guest2Instagram?: string | null;
  },
) {
  return new PostgresGuestAdminRepository(pool).update({
    reservationId: fixture.reservationId,
    actorAdminId: adminId,
    fields: {
      guests: [
        { name: "Ana López", instagram: fixture.instagram_handle },
        ...(fields.partySize === 1
          ? []
          : [
              {
                name: fields.guest2Name ?? "Luis Pérez",
                instagram: fields.guest2Instagram ?? fixture.guest2_instagram_handle,
              },
            ]),
      ],
      hasAllergies: false,
      allergies: null,
      notes: null,
      ...fields,
    },
  });
}

describe("editing companion contacts", () => {
  it("removes the companion link and discards only their unsent messages without a live lease", async () => {
    const fixture = await couple({ companionContact: true });
    const before = await seedEditMessages(fixture, true);

    expect(
      await editCompanion(fixture, {
        partySize: 1,
        guest2Name: null,
        guest2Instagram: null,
      }),
    ).toMatchObject({ ok: true });

    const after = await editMessages(fixture.reservationId);
    expect(after).toHaveLength(before.length);
    for (const message of before) {
      const expected =
        message.guest_slot === 2 && message.location_revision <= 4
          ? {
              ...message,
              status: "DISCARDED",
              handled_by: adminId,
              locked_until: null,
              claims_without_progress: 0,
            }
          : message;
      expect(after.find((row) => row.id === message.id)).toEqual(expected);
    }
    const reservation = await pool.query(
      `SELECT r.guest2_contact_id, r.guest2_full_name, r.guest2_instagram_handle,
              r.contact_id, r.party_size, e.reserved_seats
         FROM reservations r JOIN events e ON e.id = r.event_id WHERE r.id = $1`,
      [fixture.reservationId],
    );
    expect(reservation.rows).toEqual([
      {
        guest2_contact_id: null,
        guest2_full_name: null,
        guest2_instagram_handle: null,
        contact_id: fixture.primaryId,
        party_size: 1,
        reserved_seats: 1,
      },
    ]);
  });

  it("clears the companion link and delivery progress on a handle change and relinks the new username", async () => {
    const fixture = await couple({ companionContact: true });
    const before = await seedEditMessages(fixture, false);
    const username = `${fixture.guest2_instagram_handle}.new`;

    expect(await editCompanion(fixture, { guest2Instagram: username })).toMatchObject({ ok: true });

    const after = await editMessages(fixture.reservationId);
    expect(after).toHaveLength(before.length);
    const pending = before.filter(
      (message) => message.guest_slot === 2 && message.location_revision <= 5,
    );
    for (const message of before) {
      const expected = pending.some((row) => row.id === message.id)
        ? {
            ...message,
            status: "WAITING_CONTACT",
            contact_id: null,
            parts_sent: 0,
            external_part_ids: null,
            attempts: 0,
            claims_without_progress: 0,
            locked_until: null,
            last_error: null,
          }
        : message;
      expect(after.find((row) => row.id === message.id)).toEqual(expected);
    }
    const reservation = await pool.query(
      "SELECT contact_id, guest2_contact_id, guest2_instagram_handle FROM reservations WHERE id = $1",
      [fixture.reservationId],
    );
    expect(reservation.rows).toEqual([
      {
        contact_id: fixture.primaryId,
        guest2_contact_id: null,
        guest2_instagram_handle: username,
      },
    ]);

    const newContact = await writeAs(username);
    expect(newContact).not.toBe(fixture.companionId);
    const relinked = await editMessages(fixture.reservationId);
    for (const message of pending) {
      expect(relinked.find((row) => row.id === message.id)).toMatchObject({
        status: "QUEUED",
        contact_id: newContact,
        parts_sent: 0,
        external_part_ids: null,
      });
    }
  });

  it("keeps the companion link and every message unchanged on a name-only edit", async () => {
    const fixture = await couple({ companionContact: true });
    const before = await seedEditMessages(fixture, true);

    expect(await editCompanion(fixture, { guest2Name: "Luis Rodríguez" })).toMatchObject({
      ok: true,
    });

    expect(await editMessages(fixture.reservationId)).toEqual(before);
    const reservation = await pool.query(
      "SELECT contact_id, guest2_contact_id, guest2_full_name FROM reservations WHERE id = $1",
      [fixture.reservationId],
    );
    expect(reservation.rows).toEqual([
      {
        contact_id: fixture.primaryId,
        guest2_contact_id: fixture.companionId,
        guest2_full_name: "Luis Rodríguez",
      },
    ]);
  });
});

describe("location recipients", () => {
  it("sends only chosen people, ignores ineligible people, retries only those chosen and respects revisions", async () => {
    const fixture = await couple();
    const other = await insertGuestReservation(pool, fixture.eventId);
    const notPaid = await insertGuestReservation(pool, fixture.eventId, { stage: "ON_LIST" });
    const chosen = [{ reservationId: fixture.reservationId, slot: 2 as const }];
    const sent = await locations.sendLocationToPeople(
      fixture.eventId,
      version,
      [
        ...chosen,
        ...chosen,
        { reservationId: other, slot: 2 },
        { reservationId: notPaid, slot: 1 },
        { reservationId: randomUUID(), slot: 1 },
      ],
      adminId,
    );
    if (!sent.ok) throw new Error(sent.error);
    expect(sent.messageIds).toHaveLength(1);
    expect(await rows(fixture.reservationId)).toMatchObject([
      { guest_slot: 2, status: "WAITING_CONTACT" },
    ]);
    await pool.query("UPDATE messages SET status = 'FAILED' WHERE id = $1", [sent.messageIds[0]]);
    const primary = await locations.sendLocationToPeople(
      fixture.eventId,
      version,
      [{ reservationId: fixture.reservationId, slot: 1 }],
      adminId,
    );
    if (!primary.ok) throw new Error(primary.error);
    expect(primary.messageIds).toHaveLength(1);
    expect((await rows(fixture.reservationId))[1]!.status).toBe("FAILED");
    const retried = await locations.sendLocationToPeople(fixture.eventId, version, chosen, adminId);
    expect(retried).toMatchObject({ ok: true, messageIds: sent.messageIds });
    const all = await locations.sendLocationToPaidGuests(fixture.eventId, version, adminId);
    if (!all.ok) throw new Error(all.error);
    expect(all.messageIds).toHaveLength(1);
    expect(await locations.getLocationDeliverySummary(fixture.eventId)).toMatchObject({
      paid: 3,
      pending: 3,
    });
    const groups = await locations.listLocationRecipients(fixture.eventId);
    expect(groups.map((group) => group.reservationId)).toEqual([fixture.reservationId, other]);
    expect(groups[0]!.people).toMatchObject([
      { slot: 1, linked: true, statusByItem: { "0": "PENDING" } },
      {
        slot: 2,
        linked: false,
        instagram: fixture.guest2_instagram_handle,
        statusByItem: { "0": "PENDING" },
      },
    ]);
    await pool.query("UPDATE events SET location_revision = 1 WHERE id = $1", [fixture.eventId]);
    expect(await locations.sendLocationToPeople(fixture.eventId, version, chosen, adminId)).toEqual(
      { ok: false, error: "LOCATION_CHANGED" },
    );
    expect(
      await locations.sendLocationToPeople(
        fixture.eventId,
        { ...version, revision: 1 },
        chosen,
        adminId,
      ),
    ).toMatchObject({ ok: true, messageIds: [expect.any(String)] });
    expect((await locations.listLocationRecipients(fixture.eventId))[0]!.people).toMatchObject([
      { statusByItem: { "1": "NOT_SENT" } },
      { statusByItem: { "1": "PENDING" } },
    ]);
  });

  it("automatically queues both people with their own contacts and labels a Waze link", async () => {
    const fixture = await couple({ companionContact: true });
    await pool.query("UPDATE events SET location_maps_url = 'https://waze.com/ul' WHERE id = $1", [
      fixture.eventId,
    ]);
    await pool.query("UPDATE reservations SET stage = 'ON_LIST', paid_at = NULL WHERE id = $1", [
      fixture.reservationId,
    ]);
    const paid = await new PostgresGuestAdminRepository(pool).verifyPayment({
      reservationId: fixture.reservationId,
      paymentNote: null,
      actorAdminId: adminId,
    });
    expect(paid.ok).toBe(true);
    const queued = await rows(fixture.reservationId);
    expect(queued.filter((row) => row.kind === "LOCATION")).toMatchObject([
      { guest_slot: 1, contact_id: fixture.primaryId },
      { guest_slot: 2, contact_id: fixture.companionId },
    ]);
    expect(queued.filter((row) => row.kind === "PAID")).toMatchObject([
      { guest_slot: 1, contact_id: fixture.primaryId },
    ]);
    const bodies = await pool.query<{ body: string }>(
      "SELECT body FROM messages WHERE reservation_id = $1 AND kind = 'LOCATION'",
      [fixture.reservationId],
    );
    expect(bodies.rows.every((row) => row.body.includes("Waze: https://waze.com/ul"))).toBe(true);
    expect(
      (
        await inEventLock(pool, fixture.eventId, (client) =>
          queueLocationMessage(client, fixture.eventId, fixture.reservationId),
        )
      ).outcome,
    ).toBe("ALREADY_QUEUED");
  });

  it("confirms and updates a Waze-only location and increments its revision", async () => {
    const fixture = await couple();
    await pool.query(
      "UPDATE events SET location_status = 'PENDING', location_confirmed_at = NULL, location_address = NULL, location_maps_url = 'https://waze.com/ul' WHERE id = $1",
      [fixture.eventId],
    );
    const events = new PostgresEventRepository(pool);
    const confirmed = await events.setLocationStatus(
      fixture.eventId,
      "CONFIRMED",
      { revision: 0, status: "PENDING" },
      adminId,
    );
    if (!confirmed.ok) throw new Error(confirmed.error);
    expect(confirmed.value.location.mapsUrl).toBe("https://waze.com/ul");
    const event = confirmed.value;
    const updated = await events.update(
      {
        id: event.id,
        internalName: event.internalName,
        slug: event.slug,
        startsAt: event.startsAt,
        opensAt: event.opensAt,
        closesAt: event.closesAt,
        maxPartySize: event.maxPartySize,
        autoCloseOnFull: event.autoCloseOnFull,
        location: { ...event.location, mapsUrl: "https://ul.waze.com/ul" },
        keepMapsUrl: false,
        coordinates: null,
        expectedLocation: version,
      },
      adminId,
    );
    expect(updated).toMatchObject({
      ok: true,
      value: { locationRevision: 1, location: { mapsUrl: "https://ul.waze.com/ul" } },
    });
  });
});
