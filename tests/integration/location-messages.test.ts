import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deliverMessagesNow } from "@/application/messaging/deliver-messages";
import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import {
  PostgresLocationMessageRepository,
  queueLocationMessage,
} from "@/infrastructure/db/repositories/postgres-location-message-repository";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

import {
  inEventLock as holdEventLock,
  insertAdminUser,
  insertEventPhoto,
  insertGuestReservation,
  insertLocationEvent,
  insertLocationMessage as insertLocationMessageRow,
  insertMessagingContact,
  listLocationMessages,
  LOCATION_TEST_STARTS_AT as STARTS_AT,
  type GuestReservationOptions,
  type LocationEventOptions,
} from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const APP_BASE_URL = "http://localhost:3000";
const DEFAULT_LOCATION_TEXT =
  "Casa Secreta\nCalle 1, San Salvador\nToca el timbre\nhttps://maps.google.com/?q=casa";

let pool: Pool;
let repository: PostgresLocationMessageRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresLocationMessageRepository(pool);
  adminId = await insertAdminUser(pool, "Admin Ubicación");
});

afterAll(async () => {
  await pool.end();
});

const insertEvent = (options?: LocationEventOptions) => insertLocationEvent(pool, options);
const insertContact = (lastInboundAt?: Date | null) => insertMessagingContact(pool, lastInboundAt);
const insertReservation = (eventId: string, options?: GuestReservationOptions) =>
  insertGuestReservation(pool, eventId, options);
const insertPhoto = (eventId: string, uploadedAt: Date) =>
  insertEventPhoto(pool, { eventId, adminId, uploadedAt });
const locationMessages = (eventId: string) => listLocationMessages(pool, eventId);
const insertLocationMessage = (
  eventId: string,
  reservationId: string,
  input: { status: string; revision?: number; contactId?: string | null; sentAt?: Date | null },
) => insertLocationMessageRow(pool, { eventId, reservationId, ...input });
const inEventLock = <T>(eventId: string, work: (client: PoolClient) => Promise<T>) =>
  holdEventLock(pool, eventId, work);

function queueInLock(eventId: string, reservationId: string) {
  return inEventLock(eventId, (client) => queueLocationMessage(client, eventId, reservationId));
}

function expectedBody(locationText: string): string {
  return `Esta es la ubicación de la experiencia del ${formatPublicEventDate(STARTS_AT)}:\n\n${locationText}\n\nNo la compartas con nadie.`;
}

function send(eventId: string, revision = 0, status: "PENDING" | "CONFIRMED" = "CONFIRMED") {
  return repository.sendLocationToPaidGuests(eventId, { revision, status }, adminId);
}

describe("queueLocationMessage", () => {
  it("queues the rendered location for a paid reservation with a linked conversation", async () => {
    const eventId = await insertEvent();
    const contactId = await insertContact();
    const reservationId = await insertReservation(eventId, { contactId });

    const result = await queueInLock(eventId, reservationId);

    expect(result).toEqual({ outcome: "QUEUED", messageId: expect.any(String) });
    const [message] = await locationMessages(eventId);
    expect(message).toMatchObject({
      reservation_id: reservationId,
      contact_id: contactId,
      status: "QUEUED",
      location_revision: 0,
      source: "SYSTEM",
      created_by: null,
      attachment_urls: null,
      body: expectedBody(DEFAULT_LOCATION_TEXT),
    });
    expect(result.outcome === "QUEUED" && result.messageId).toBe(message!.id);
  });

  it("waits for the conversation when the reservation has none yet", async () => {
    const eventId = await insertEvent();
    const reservationId = await insertReservation(eventId);

    await queueInLock(eventId, reservationId);

    const [message] = await locationMessages(eventId);
    expect(message).toMatchObject({ status: "WAITING_CONTACT", contact_id: null });
  });

  it("attaches up to six venue photos in upload order", async () => {
    const eventId = await insertEvent();
    const reservationId = await insertReservation(eventId);
    const tokens: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      tokens.push(await insertPhoto(eventId, new Date(Date.UTC(2030, 0, 1, 0, index))));
    }

    await queueInLock(eventId, reservationId);

    const [message] = await locationMessages(eventId);
    expect(message!.attachment_urls).toEqual(
      tokens.slice(0, 6).map((token) => `${APP_BASE_URL}/ubicacion/foto/${token}`),
    );
  });

  it("composes the text from the filled parts only", async () => {
    const eventId = await insertEvent({ name: null, notes: null, mapsUrl: null });
    const reservationId = await insertReservation(eventId);

    await queueInLock(eventId, reservationId);

    const [message] = await locationMessages(eventId);
    expect(message!.body).toBe(expectedBody("Calle 1, San Salvador"));
  });

  it("renders the editable template variables with the guest names", async () => {
    const eventId = await insertEvent();
    const reservationId = await insertReservation(eventId, {
      fullName: "Ana López",
      guest2FullName: "Luis Pérez",
    });
    const original = await pool.query<{ body: string }>(
      "SELECT body FROM message_templates WHERE key = 'LOCATION'",
    );
    await pool.query(
      "UPDATE message_templates SET body = 'Hola {nombres} ({nombre}), {fecha}:\n{ubicacion}' WHERE key = 'LOCATION'",
    );

    try {
      await queueInLock(eventId, reservationId);
    } finally {
      await pool.query("UPDATE message_templates SET body = $1 WHERE key = 'LOCATION'", [
        original.rows[0]!.body,
      ]);
    }

    const [message] = await locationMessages(eventId);
    expect(message!.body).toBe(
      `Hola Ana y Luis (Ana), ${formatPublicEventDate(STARTS_AT)}:\n${DEFAULT_LOCATION_TEXT}`,
    );
  });

  it.each([
    ["in review", { stage: "IN_REVIEW" }],
    ["on the list", { stage: "ON_LIST" }],
    ["cancelled", { status: "CANCELLED" }],
  ] as const)("queues nothing for a reservation that is %s", async (_label, overrides) => {
    const eventId = await insertEvent();
    const reservationId = await insertReservation(eventId, overrides);

    await expect(queueInLock(eventId, reservationId)).resolves.toEqual({
      outcome: "NOT_APPLICABLE",
    });
    expect(await locationMessages(eventId)).toEqual([]);
  });

  it("queues nothing while the location is pending", async () => {
    const eventId = await insertEvent({ confirmed: false });
    const reservationId = await insertReservation(eventId);

    await expect(queueInLock(eventId, reservationId)).resolves.toEqual({
      outcome: "NOT_APPLICABLE",
    });
    expect(await locationMessages(eventId)).toEqual([]);
  });

  it("queues nothing for a reservation of another event", async () => {
    const eventId = await insertEvent();
    const otherEventId = await insertEvent();
    const foreignReservation = await insertReservation(otherEventId);

    await expect(queueInLock(eventId, foreignReservation)).resolves.toEqual({
      outcome: "NOT_APPLICABLE",
    });
    expect(await locationMessages(otherEventId)).toEqual([]);
  });

  it("queues for the current location revision", async () => {
    const eventId = await insertEvent();
    await pool.query("UPDATE events SET location_revision = 3 WHERE id = $1", [eventId]);
    const reservationId = await insertReservation(eventId);

    await queueInLock(eventId, reservationId);

    const [message] = await locationMessages(eventId);
    expect(message!.location_revision).toBe(3);
  });

  it("is idempotent for the same reservation and revision", async () => {
    const eventId = await insertEvent();
    const reservationId = await insertReservation(eventId);

    const first = await queueInLock(eventId, reservationId);
    const second = await queueInLock(eventId, reservationId);

    expect(first.outcome).toBe("QUEUED");
    expect(second).toEqual({ outcome: "ALREADY_QUEUED" });
    expect(await locationMessages(eventId)).toHaveLength(1);
  });

  it("skips a location that does not fit in one message, never truncates and never throws", async () => {
    const eventId = await insertEvent({
      notes: "n".repeat(1000),
      mapsUrl: `https://maps.google.com/?q=${"a".repeat(1100)}`,
    });
    const reservationId = await insertReservation(eventId);

    const result = await inEventLock(eventId, async (client) => {
      const outcome = await queueLocationMessage(client, eventId, reservationId);
      await client.query("SELECT 1");
      return outcome;
    });

    expect(result).toEqual({ outcome: "TOO_LONG" });
    expect(await locationMessages(eventId)).toEqual([]);
  });

  it("accepts a body of exactly 2000 characters and rejects one character more", async () => {
    // address 300 + notes 1000 + Maps link 698 + two line breaks = 2000 with a bare {ubicacion} template.
    const fixture = { name: null, address: "a".repeat(300), notes: "b".repeat(1000) };
    const fittingEvent = await insertEvent({
      ...fixture,
      mapsUrl: `https://maps.google.com/?q=${"c".repeat(671)}`,
    });
    const overflowingEvent = await insertEvent({
      ...fixture,
      mapsUrl: `https://maps.google.com/?q=${"c".repeat(672)}`,
    });
    const fittingReservation = await insertReservation(fittingEvent);
    const overflowingReservation = await insertReservation(overflowingEvent);
    const template = await pool.query<{ body: string }>(
      "SELECT body FROM message_templates WHERE key = 'LOCATION'",
    );
    await pool.query("UPDATE message_templates SET body = '{ubicacion}' WHERE key = 'LOCATION'");

    try {
      await expect(queueInLock(fittingEvent, fittingReservation)).resolves.toMatchObject({
        outcome: "QUEUED",
      });
      await expect(queueInLock(overflowingEvent, overflowingReservation)).resolves.toEqual({
        outcome: "TOO_LONG",
      });
    } finally {
      await pool.query("UPDATE message_templates SET body = $1 WHERE key = 'LOCATION'", [
        template.rows[0]!.body,
      ]);
    }

    const [message] = await locationMessages(fittingEvent);
    expect(message!.body).toHaveLength(2000);
    expect(await locationMessages(overflowingEvent)).toEqual([]);
  });
});

describe("sendLocationToPaidGuests", () => {
  it("queues the location for every paid reservation and returns the new message ids", async () => {
    const eventId = await insertEvent();
    const linkedContact = await insertContact();
    const paidLinked = await insertReservation(eventId, { contactId: linkedContact });
    const paidUnlinked = await insertReservation(eventId);
    await insertReservation(eventId, { stage: "IN_REVIEW" });
    await insertReservation(eventId, { stage: "ON_LIST" });
    await insertReservation(eventId, { status: "CANCELLED" });
    const photo = await insertPhoto(eventId, new Date("2030-01-01T00:00:00Z"));

    const result = await send(eventId);

    expect(result).toEqual({ ok: true, messageIds: expect.any(Array), locationRevision: 0 });
    const messages = await locationMessages(eventId);
    expect(messages).toHaveLength(2);
    expect(result.ok && result.messageIds.sort()).toEqual(messages.map((row) => row.id).sort());
    const byReservation = new Map(messages.map((row) => [row.reservation_id, row]));
    expect(byReservation.get(paidLinked)).toMatchObject({
      status: "QUEUED",
      contact_id: linkedContact,
      source: "ADMIN",
      created_by: adminId,
      body: expectedBody(DEFAULT_LOCATION_TEXT),
      attachment_urls: [`${APP_BASE_URL}/ubicacion/foto/${photo}`],
    });
    expect(byReservation.get(paidUnlinked)).toMatchObject({
      status: "WAITING_CONTACT",
      contact_id: null,
    });
  });

  it("records the released revision and one audit entry", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId);

    await send(eventId);

    const event = await pool.query<{ released: number | null }>(
      "SELECT location_released_revision AS released FROM events WHERE id = $1",
      [eventId],
    );
    expect(event.rows[0]!.released).toBe(0);
    const audit = await pool.query<{ action: string; actor_admin_id: string; metadata: unknown }>(
      "SELECT action, actor_admin_id, metadata FROM audit_logs WHERE entity_id = $1",
      [eventId],
    );
    expect(audit.rows).toEqual([
      {
        action: "EVENT_UPDATED",
        actor_admin_id: adminId,
        metadata: { locationMessagesQueued: 1, locationRevision: 0 },
      },
    ]);
  });

  it("queues nothing the second time for the same revision", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId);
    await insertReservation(eventId);

    await send(eventId);
    const second = await send(eventId);

    expect(second).toEqual({ ok: true, messageIds: [], locationRevision: 0 });
    expect(await locationMessages(eventId)).toHaveLength(2);
  });

  it("includes a reservation that became paid after an earlier send", async () => {
    const eventId = await insertEvent();
    const first = await insertReservation(eventId);
    await send(eventId);
    const late = await insertReservation(eventId);

    const result = await send(eventId);

    const messages = await locationMessages(eventId);
    expect(result.ok && result.messageIds).toEqual(
      messages.filter((row) => row.reservation_id === late).map((row) => row.id),
    );
    expect(messages.map((row) => row.reservation_id).sort()).toEqual([first, late].sort());
  });

  it("revives FAILED and DISCARDED rows of the current revision and leaves the rest alone", async () => {
    const eventId = await insertEvent();
    const failedContact = await insertContact();
    const discardedContact = await insertContact();
    const sentContact = await insertContact();
    const queuedContact = await insertContact();
    const failedGuest = await insertReservation(eventId, { contactId: failedContact });
    const discardedGuest = await insertReservation(eventId, { contactId: discardedContact });
    const unlinkedGuest = await insertReservation(eventId);
    const sentGuest = await insertReservation(eventId, { contactId: sentContact });
    const queuedGuest = await insertReservation(eventId, { contactId: queuedContact });
    const failed = await insertLocationMessage(eventId, failedGuest, {
      status: "FAILED",
      contactId: failedContact,
    });
    const discarded = await insertLocationMessage(eventId, discardedGuest, {
      status: "DISCARDED",
    });
    const unlinked = await insertLocationMessage(eventId, unlinkedGuest, { status: "DISCARDED" });
    const sent = await insertLocationMessage(eventId, sentGuest, {
      status: "SENT",
      contactId: sentContact,
    });
    const queued = await insertLocationMessage(eventId, queuedGuest, {
      status: "QUEUED",
      contactId: queuedContact,
    });

    const result = await send(eventId);

    expect(result.ok && result.messageIds.sort()).toEqual([discarded, failed, unlinked].sort());
    const rows = new Map((await locationMessages(eventId)).map((row) => [row.id, row]));
    expect(rows.get(failed)).toMatchObject({ status: "QUEUED", attempts: 0, last_error: null });
    expect(rows.get(discarded)).toMatchObject({ status: "QUEUED", attempts: 0 });
    expect(rows.get(unlinked)).toMatchObject({ status: "WAITING_CONTACT", contact_id: null });
    expect(rows.get(sent)!.status).toBe("SENT");
    expect(rows.get(queued)!.status).toBe("QUEUED");
    expect(rows.size).toBe(5);
  });

  it("does not revive a FAILED row of an older revision or of a cancelled reservation", async () => {
    const eventId = await insertEvent();
    await pool.query("UPDATE events SET location_revision = 1 WHERE id = $1", [eventId]);
    const contactId = await insertContact();
    const paid = await insertReservation(eventId, { contactId });
    const cancelled = await insertReservation(eventId, { status: "CANCELLED", contactId });
    const olderFailed = await insertLocationMessage(eventId, paid, {
      status: "FAILED",
      revision: 0,
      contactId,
    });
    const cancelledFailed = await insertLocationMessage(eventId, cancelled, {
      status: "FAILED",
      revision: 1,
      contactId,
    });

    const result = await send(eventId, 1);

    const rows = new Map((await locationMessages(eventId)).map((row) => [row.id, row]));
    expect(rows.get(olderFailed)!.status).toBe("FAILED");
    expect(rows.get(cancelledFailed)!.status).toBe("FAILED");
    expect(result.ok && result.messageIds).toHaveLength(1);
    expect(
      [...rows.values()].filter(
        (row) => row.reservation_id === paid && row.location_revision === 1,
      ),
    ).toHaveLength(1);
  });

  it("queues a new row per reservation when the location text changes", async () => {
    const eventId = await insertEvent();
    const reservationId = await insertReservation(eventId);
    await send(eventId);
    await pool.query(
      "UPDATE events SET location_notes = 'Puerta azul', location_revision = location_revision + 1 WHERE id = $1",
      [eventId],
    );

    const result = await send(eventId, 1);

    expect(result.ok && result.messageIds).toHaveLength(1);
    const rows = await locationMessages(eventId);
    expect(rows.map((row) => [row.reservation_id, row.location_revision])).toEqual([
      [reservationId, 0],
      [reservationId, 1],
    ]);
    expect(rows[1]!.body).toContain("Puerta azul");
    expect(rows[0]!.body).toContain("Toca el timbre");
  });

  it("rejects a send bound to an outdated location version and queues nothing", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId);
    await pool.query("UPDATE events SET location_revision = 1 WHERE id = $1", [eventId]);

    await expect(send(eventId, 0, "CONFIRMED")).resolves.toEqual({
      ok: false,
      error: "LOCATION_CHANGED",
    });
    await expect(send(eventId, 1, "PENDING")).resolves.toEqual({
      ok: false,
      error: "LOCATION_CHANGED",
    });
    expect(await locationMessages(eventId)).toEqual([]);
    const event = await pool.query<{ released: number | null }>(
      "SELECT location_released_revision AS released FROM events WHERE id = $1",
      [eventId],
    );
    expect(event.rows[0]!.released).toBeNull();
  });

  it("rejects a send while the location is still pending", async () => {
    const eventId = await insertEvent({ confirmed: false });
    await insertReservation(eventId);

    await expect(send(eventId, 0, "PENDING")).resolves.toEqual({
      ok: false,
      error: "LOCATION_NOT_CONFIRMED",
    });
    expect(await locationMessages(eventId)).toEqual([]);
  });

  it("reports a missing or deleted event", async () => {
    const deleted = await insertEvent();
    await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [deleted]);

    await expect(send(randomUUID())).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
    await expect(send(deleted)).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
  });

  it("fails with LOCATION_TOO_LONG, queues nothing and keeps the released revision", async () => {
    const eventId = await insertEvent({
      notes: "n".repeat(1000),
      mapsUrl: `https://maps.google.com/?q=${"a".repeat(1100)}`,
    });
    await insertReservation(eventId);
    await insertReservation(eventId);

    await expect(send(eventId)).resolves.toEqual({ ok: false, error: "LOCATION_TOO_LONG" });

    expect(await locationMessages(eventId)).toEqual([]);
    const event = await pool.query<{ released: number | null }>(
      "SELECT location_released_revision AS released FROM events WHERE id = $1",
      [eventId],
    );
    expect(event.rows[0]!.released).toBeNull();
  });
});

describe("getLocationDeliverySummary", () => {
  it("counts every delivery state of the paid reservations", async () => {
    const eventId = await insertEvent();
    await pool.query("UPDATE events SET location_revision = 1 WHERE id = $1", [eventId]);
    const lastSentAt = new Date("2030-11-20T15:00:00.000Z");
    const state = async (
      status: string | null,
      options: { olderDelivered?: boolean; sentAt?: Date } = {},
    ) => {
      const contactId = await insertContact();
      const reservationId = await insertReservation(eventId, { contactId });
      if (options.olderDelivered) {
        await insertLocationMessage(eventId, reservationId, {
          status: "SENT",
          revision: 0,
          contactId,
        });
      }
      if (status) {
        await insertLocationMessage(eventId, reservationId, {
          status,
          revision: 1,
          contactId: status === "DISCARDED" ? null : contactId,
          sentAt: options.sentAt,
        });
      }
    };
    await state("SENT", { sentAt: new Date("2030-11-20T10:00:00.000Z") });
    await state("READ", { sentAt: lastSentAt });
    await state("SENT_MANUALLY", { sentAt: new Date("2030-11-19T10:00:00.000Z") });
    await state("QUEUED");
    await state("WAITING_WINDOW");
    await state("WAITING_CONTACT");
    await state("FAILED");
    await state(null);
    await state("DISCARDED");
    await state(null, { olderDelivered: true });
    await state("DISCARDED", { olderDelivered: true });
    await insertReservation(eventId, { stage: "IN_REVIEW" });
    await insertReservation(eventId, { stage: "ON_LIST" });
    await insertReservation(eventId, { status: "CANCELLED" });

    await expect(repository.getLocationDeliverySummary(eventId)).resolves.toEqual({
      paid: 11,
      received: 3,
      pending: 3,
      failed: 1,
      neverQueued: 2,
      outdated: 2,
      lastDeliveredAt: lastSentAt,
    });
  });

  it("counts a guest who only received an older revision as outdated until the new send", async () => {
    const eventId = await insertEvent();
    const contactId = await insertContact();
    const reservationId = await insertReservation(eventId, { contactId });
    await insertLocationMessage(eventId, reservationId, {
      status: "SENT",
      revision: 0,
      contactId,
    });
    await pool.query(
      "UPDATE events SET location_notes = 'Nueva puerta', location_revision = 1 WHERE id = $1",
      [eventId],
    );

    await expect(repository.getLocationDeliverySummary(eventId)).resolves.toMatchObject({
      paid: 1,
      received: 0,
      outdated: 1,
      neverQueued: 0,
    });

    await send(eventId, 1);

    await expect(repository.getLocationDeliverySummary(eventId)).resolves.toMatchObject({
      paid: 1,
      received: 0,
      pending: 1,
      outdated: 0,
      neverQueued: 0,
    });
  });

  it("returns zeros for an event without paid reservations and for an unknown event", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId, { stage: "ON_LIST" });
    const zeros = {
      paid: 0,
      received: 0,
      pending: 0,
      failed: 0,
      neverQueued: 0,
      outdated: 0,
      lastDeliveredAt: null,
    };

    await expect(repository.getLocationDeliverySummary(eventId)).resolves.toEqual(zeros);
    await expect(repository.getLocationDeliverySummary(randomUUID())).resolves.toEqual(zeros);
  });
});

describe("delivering queued location messages", () => {
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

  function deliver(messageIds: string[], messenger: InstagramMessenger) {
    return deliverMessagesNow(
      {
        repository: new PostgresMessageRepository(pool),
        messenger,
        now: Date.now,
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      messageIds,
      { timeBudgetMs: 5_000 },
    );
  }

  it("sends the text and every photo to a guest whose window is open", async () => {
    const eventId = await insertEvent();
    const contactId = await insertContact();
    await insertReservation(eventId, { contactId });
    const photos = [
      await insertPhoto(eventId, new Date("2030-01-01T00:00:00Z")),
      await insertPhoto(eventId, new Date("2030-01-01T00:01:00Z")),
    ];
    const result = await send(eventId);
    if (!result.ok) throw new Error(result.error);
    const messenger = fakeMessenger();

    const summary = await deliver(result.messageIds, messenger);

    expect(summary.sent).toBe(1);
    expect(messenger.sendText).toHaveBeenCalledWith(
      expect.any(String),
      expectedBody(DEFAULT_LOCATION_TEXT),
    );
    expect(vi.mocked(messenger.sendImage).mock.calls.map((call) => call[1])).toEqual(
      photos.map((token) => `${APP_BASE_URL}/ubicacion/foto/${token}`),
    );
    expect((await locationMessages(eventId))[0]!.status).toBe("SENT");
    await expect(repository.getLocationDeliverySummary(eventId)).resolves.toMatchObject({
      paid: 1,
      received: 1,
      pending: 0,
    });
  });

  it("holds the message for a guest who has not written in 24 hours", async () => {
    const eventId = await insertEvent();
    const contactId = await insertContact(new Date(Date.now() - 30 * 60 * 60 * 1000));
    await insertReservation(eventId, { contactId });
    const result = await send(eventId);
    if (!result.ok) throw new Error(result.error);
    const messenger = fakeMessenger();

    const summary = await deliver(result.messageIds, messenger);

    expect(summary.waitingWindow).toBe(1);
    expect(messenger.sendText).not.toHaveBeenCalled();
    await expect(repository.getLocationDeliverySummary(eventId)).resolves.toMatchObject({
      pending: 1,
      received: 0,
    });
  });

  it("discards a message queued for a revision that was edited before it went out", async () => {
    const eventId = await insertEvent();
    const contactId = await insertContact();
    await insertReservation(eventId, { contactId });
    const result = await send(eventId);
    if (!result.ok) throw new Error(result.error);
    await pool.query(
      "UPDATE events SET location_notes = 'Otra puerta', location_revision = 1 WHERE id = $1",
      [eventId],
    );
    const messenger = fakeMessenger();

    const summary = await deliver(result.messageIds, messenger);

    expect(summary.discarded).toBe(1);
    expect(messenger.sendText).not.toHaveBeenCalled();
    await expect(repository.getLocationDeliverySummary(eventId)).resolves.toMatchObject({
      received: 0,
      neverQueued: 1,
    });
  });

  it("discards a message when the reservation is cancelled before it goes out", async () => {
    const eventId = await insertEvent();
    const contactId = await insertContact();
    const reservationId = await insertReservation(eventId, { contactId });
    const result = await send(eventId);
    if (!result.ok) throw new Error(result.error);
    await pool.query(
      "UPDATE reservations SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
      [reservationId],
    );
    const messenger = fakeMessenger();

    const summary = await deliver(result.messageIds, messenger);

    expect(summary.discarded).toBe(1);
    expect(messenger.sendText).not.toHaveBeenCalled();
  });
});
