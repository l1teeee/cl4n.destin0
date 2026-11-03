import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { publishEventClue, removeEventClue } from "@/application/events/event-clues";
import { deliverMessagesNow } from "@/application/messaging/deliver-messages";
import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import { enqueueClueMessages } from "@/infrastructure/db/repositories/clue-messages";
import { PostgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

import {
  insertAdminUser,
  insertGuestReservation,
  insertLocationEvent,
  insertMessagingContact,
  waitUntilSomeoneIsBlocked,
} from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const APP_BASE_URL = "http://localhost:3000";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const image = { contentType: "image/png" as const, data: png };

let pool: Pool;
let clueRepository: PostgresEventClueRepository;
let eventRepository: PostgresEventRepository;
let adminId: string;

interface ClueMessageRow {
  id: string;
  reservation_id: string;
  contact_id: string | null;
  clue_id: string | null;
  status: string;
  source: string;
  created_by: string | null;
  body: string;
  attachment_urls: string[] | null;
  location_revision: number | null;
}

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  clueRepository = new PostgresEventClueRepository(pool);
  eventRepository = new PostgresEventRepository(pool);
  adminId = await insertAdminUser(pool, "Admin Pistas");
});

afterAll(async () => {
  await pool.end();
});

async function insertClosedEvent(): Promise<{ id: string; slug: string }> {
  const id = await insertLocationEvent(pool);
  const event = await pool.query<{ slug: string }>(
    "UPDATE events SET status = 'CLOSED' WHERE id = $1 RETURNING slug",
    [id],
  );
  return { id, slug: event.rows[0]!.slug };
}

async function clueMessages(eventId: string): Promise<ClueMessageRow[]> {
  const result = await pool.query<ClueMessageRow>(
    `SELECT id, reservation_id, contact_id, clue_id, status, source, created_by, body,
            attachment_urls, location_revision
       FROM messages
      WHERE event_id = $1 AND kind = 'CLUE'
      ORDER BY created_at, id`,
    [eventId],
  );
  return result.rows;
}

async function addAndSendClue(eventId: string, body = "Mira bajo la mesa.", withImages = 0) {
  const result = await clueRepository.add({
    eventId,
    body,
    actorId: adminId,
    images: Array.from({ length: withImages }, () => image),
  });
  if (!result.ok) throw new Error(result.error);
  const sent = await clueRepository.sendToAll({
    eventId,
    clueId: result.value.id,
    actorId: adminId,
  });
  if (!sent.ok) throw new Error(sent.error);
  return { value: result.value, messageIds: sent.messageIds };
}

function fakeMessenger(): InstagramMessenger {
  return {
    sendText: vi.fn(async () => ({ messageId: "meta-text" })),
    sendImage: vi.fn(async () => ({ messageId: "meta-image" })),
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

describe("explicitly sending a clue queues it for the paid guests", () => {
  it("queues one CLUE message per paid reservation with the clue text and image URLs", async () => {
    const event = await insertClosedEvent();
    const contactId = await insertMessagingContact(pool);
    const linked = await insertGuestReservation(pool, event.id, { contactId });
    const unlinked = await insertGuestReservation(pool, event.id);
    await insertGuestReservation(pool, event.id, { stage: "IN_REVIEW" });
    await insertGuestReservation(pool, event.id, { stage: "ON_LIST" });
    await insertGuestReservation(pool, event.id, { status: "CANCELLED" });

    const result = await publishEventClue(eventRepository, clueRepository, {
      eventId: event.id,
      body: "Mira bajo la mesa.",
      actorId: adminId,
      images: [image, image],
    });

    if (!result.ok) throw new Error(result.error);
    expect(await clueMessages(event.id)).toEqual([]);
    const sent = await clueRepository.sendToAll({
      eventId: event.id,
      clueId: result.value.id,
      actorId: adminId,
    });
    if (!sent.ok) throw new Error(sent.error);
    const rows = await clueMessages(event.id);
    expect(rows).toHaveLength(2);
    expect(sent.messageIds.sort()).toEqual(rows.map((row) => row.id).sort());
    const imageUrls = result.value.images.map(
      (stored) => `${APP_BASE_URL}/pistas/${event.slug}/imagenes/${stored.id}`,
    );
    expect(imageUrls).toHaveLength(2);
    const byReservation = new Map(rows.map((row) => [row.reservation_id, row]));
    expect(byReservation.get(linked)).toMatchObject({
      status: "QUEUED",
      contact_id: contactId,
      clue_id: result.value.id,
      body: "Mira bajo la mesa.",
      attachment_urls: imageUrls,
      source: "ADMIN",
      created_by: adminId,
      location_revision: null,
    });
    expect(byReservation.get(unlinked)).toMatchObject({
      status: "WAITING_CONTACT",
      contact_id: null,
      attachment_urls: imageUrls,
    });
  });

  it("stores no attachment list for a text-only clue", async () => {
    const event = await insertClosedEvent();
    await insertGuestReservation(pool, event.id);

    await addAndSendClue(event.id, "Solo texto.");

    const [row] = await clueMessages(event.id);
    expect(row).toMatchObject({ body: "Solo texto.", attachment_urls: null });
  });

  it("queues nothing when no reservation is paid yet", async () => {
    const event = await insertClosedEvent();
    await insertGuestReservation(pool, event.id, { stage: "ON_LIST" });

    const clue = await addAndSendClue(event.id);

    expect(clue.messageIds).toEqual([]);
    expect(await clueMessages(event.id)).toEqual([]);
    expect(await clueRepository.listForEvent(event.id)).toEqual([clue.value]);
  });

  it("queues each clue once even if the enqueue runs again for the same clue", async () => {
    const event = await insertClosedEvent();
    await insertGuestReservation(pool, event.id);
    await insertGuestReservation(pool, event.id);
    const clue = await addAndSendClue(event.id, "Primera pista.", 1);

    const second = await addAndSendClue(event.id, "Segunda pista.");
    const rerun = await (async () => {
      const client = await pool.connect();
      try {
        return await enqueueClueMessages(client, {
          eventId: event.id,
          eventSlug: event.slug,
          clueId: clue.value.id,
          body: clue.value.body,
          imageIds: clue.value.images.map((stored) => stored.id),
          actorId: adminId,
        });
      } finally {
        client.release();
      }
    })();

    expect(rerun).toEqual([]);
    const rows = await clueMessages(event.id);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.clue_id === clue.value.id)).toHaveLength(2);
    expect(rows.filter((row) => row.clue_id === second.value.id)).toHaveLength(2);
  });

  it("does not automatically reach a guest who became paid after the explicit send", async () => {
    const event = await insertClosedEvent();
    await insertGuestReservation(pool, event.id);
    const clue = await addAndSendClue(event.id);
    const latecomer = await insertGuestReservation(pool, event.id);

    const rows = await clueMessages(event.id);

    expect(rows.map((row) => row.reservation_id)).not.toContain(latecomer);
    const delivery = await clueRepository.getDeliveryForEvent(event.id);
    expect(delivery[clue.value.id]).toEqual({ paid: 2, received: 0, pending: 1, failed: 0 });
  });

  it("does not wait for a reservation transaction that holds the event row", async () => {
    const event = await insertClosedEvent();
    await insertGuestReservation(pool, event.id);
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("UPDATE events SET reserved_seats = reserved_seats WHERE id = $1", [
        event.id,
      ]);

      const result = await Promise.race([
        addAndSendClue(event.id),
        new Promise<"BLOCKED">((resolve) => setTimeout(() => resolve("BLOCKED"), 2_000)),
      ]);

      expect(result).not.toBe("BLOCKED");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect(await clueMessages(event.id)).toHaveLength(1);
  });

  it("leaves no QUEUED row on a conversation that is unlinked while the clue is sent", async () => {
    const event = await insertClosedEvent();
    const contactId = await insertMessagingContact(pool);
    const reservationId = await insertGuestReservation(pool, event.id, { contactId });
    const unlink = await pool.connect();
    await unlink.query("BEGIN");
    await unlink.query(
      "UPDATE reservations SET contact_id = NULL, contact_linked_by = NULL WHERE id = $1",
      [reservationId],
    );

    const sending = addAndSendClue(event.id);
    await waitUntilSomeoneIsBlocked(pool);
    await unlink.query("COMMIT");
    unlink.release();
    const clue = await sending;

    expect(clue.messageIds).toHaveLength(1);
    expect(await clueMessages(event.id)).toMatchObject([
      { reservation_id: reservationId, status: "WAITING_CONTACT", contact_id: null },
    ]);
  });

  it("does not queue anything when the event does not exist", async () => {
    await expect(
      clueRepository.add({
        eventId: "00000000-0000-4000-8000-000000000999",
        body: "Nada",
        actorId: adminId,
      }),
    ).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
  });
});

describe("delivering and deleting clue messages", () => {
  it("sends the clue text and each image to a guest whose window is open", async () => {
    const event = await insertClosedEvent();
    await insertGuestReservation(pool, event.id, { contactId: await insertMessagingContact(pool) });
    const clue = await addAndSendClue(event.id, "Busca la puerta azul.", 2);
    const messenger = fakeMessenger();

    const summary = await deliver(clue.messageIds, messenger);

    expect(summary.sent).toBe(1);
    expect(messenger.sendText).toHaveBeenCalledWith(expect.any(String), "Busca la puerta azul.");
    expect(vi.mocked(messenger.sendImage).mock.calls.map((call) => call[1])).toEqual(
      clue.value.images.map(
        (stored) => `${APP_BASE_URL}/pistas/${event.slug}/imagenes/${stored.id}`,
      ),
    );
  });

  it("discards the pending messages of a clue that was deleted before they went out", async () => {
    const event = await insertClosedEvent();
    for (let index = 0; index < 2; index += 1) {
      await insertGuestReservation(pool, event.id, {
        contactId: await insertMessagingContact(pool),
      });
    }
    const clue = await addAndSendClue(event.id, "Pista que se borra.");

    await expect(
      removeEventClue(eventRepository, clueRepository, {
        eventId: event.id,
        clueId: clue.value.id,
        actorId: adminId,
      }),
    ).resolves.toEqual({ ok: true });
    const messenger = fakeMessenger();
    const summary = await deliver(clue.messageIds, messenger);

    expect(summary.discarded).toBe(2);
    expect(summary.sent).toBe(0);
    expect(messenger.sendText).not.toHaveBeenCalled();
    const rows = await clueMessages(event.id);
    expect(rows.map((row) => [row.status, row.clue_id])).toEqual([
      ["DISCARDED", null],
      ["DISCARDED", null],
    ]);
  });

  it("discards a clue message when the guest is no longer paid", async () => {
    const event = await insertClosedEvent();
    const reservationId = await insertGuestReservation(pool, event.id, {
      contactId: await insertMessagingContact(pool),
    });
    const clue = await addAndSendClue(event.id);
    await pool.query(
      "UPDATE reservations SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
      [reservationId],
    );
    const messenger = fakeMessenger();

    const summary = await deliver(clue.messageIds, messenger);

    expect(summary.discarded).toBe(1);
    expect(messenger.sendText).not.toHaveBeenCalled();
  });
});

describe("getDeliveryForEvent", () => {
  it("counts delivery states per clue among the guests who are paid now", async () => {
    const event = await insertClosedEvent();
    const reservations: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      reservations.push(
        await insertGuestReservation(pool, event.id, {
          contactId: await insertMessagingContact(pool),
        }),
      );
    }
    const first = await addAndSendClue(event.id, "Primera.");
    const second = await addAndSendClue(event.id, "Segunda.");
    await insertGuestReservation(pool, event.id);
    const statuses = ["SENT", "READ", "FAILED", "WAITING_WINDOW", "QUEUED"];
    for (const [index, reservationId] of reservations.entries()) {
      await pool.query(
        `UPDATE messages
            SET status = $3,
                sent_at = CASE WHEN $3 IN ('SENT', 'READ') THEN now() END,
                read_at = CASE WHEN $3 = 'READ' THEN now() END
          WHERE reservation_id = $1 AND clue_id = $2`,
        [reservationId, first.value.id, statuses[index]],
      );
    }
    await pool.query(
      "UPDATE reservations SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
      [reservations[0]],
    );

    const delivery = await clueRepository.getDeliveryForEvent(event.id);

    expect(delivery[first.value.id]).toEqual({ paid: 5, received: 1, pending: 2, failed: 1 });
    expect(delivery[second.value.id]).toEqual({ paid: 5, received: 0, pending: 4, failed: 0 });
  });

  it("returns nothing for an event without clues", async () => {
    const event = await insertClosedEvent();
    await insertGuestReservation(pool, event.id);

    await expect(clueRepository.getDeliveryForEvent(event.id)).resolves.toEqual({});
  });
});
