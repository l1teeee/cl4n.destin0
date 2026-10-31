import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deliverMessagesNow } from "@/application/messaging/deliver-messages";
import { ingestInstagramEvents } from "@/application/messaging/ingest-instagram-events";
import {
  MessengerError,
  type InstagramMessenger,
} from "@/application/messaging/instagram-messenger";
import {
  discardMessage,
  linkContact,
  markSentManually,
  retryMessage,
  sendFreeText,
  unlinkContact,
} from "@/application/messaging/admin-message-use-cases";
import type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresMessageRepository;

const now = new Date("2026-10-30T12:00:00Z");

function fakeMessenger(overrides: Partial<InstagramMessenger> = {}): InstagramMessenger {
  return {
    sendText: vi.fn(async () => ({ messageId: `meta-${randomUUID()}` })),
    sendImage: vi.fn(async () => ({ messageId: `meta-${randomUUID()}` })),
    fetchProfile: vi.fn(async () => ({ username: null, name: null })),
    downloadImage: vi.fn(async () => ({
      contentType: "image/png",
      data: Buffer.from("89504e470d0a1a0a", "hex"),
    })),
    ...overrides,
  };
}

function inbound(
  mid: string,
  senderId: string,
  text: string | null = "hola",
  changes: Partial<Extract<InstagramWebhookEvent, { type: "inbound_message" }>> = {},
): InstagramWebhookEvent {
  return {
    type: "inbound_message",
    externalMessageId: mid,
    senderId,
    timestamp: now,
    text,
    attachmentUrls: [],
    imageAttachmentUrls: [],
    quickReplyPayload: null,
    referralRef: null,
    ...changes,
  };
}

async function ingest(
  events: InstagramWebhookEvent[],
  messenger: InstagramMessenger = fakeMessenger(),
  knownUsernames?: Record<string, string>,
) {
  return ingestInstagramEvents(
    {
      repository,
      messenger,
      deliver: vi.fn(async () => undefined),
      logFailure: vi.fn(),
    },
    events,
    { knownUsernames },
  );
}

async function createEvent(options: { deleted?: boolean } = {}): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at,
       deleted_at
     ) VALUES ($1, $2, '2030-11-01', 20, 2, '2030-10-01', '2030-10-02', $3)
     RETURNING id`,
    [`message-${suffix}`, `Message ${suffix}`, options.deleted ? now : null],
  );
  return result.rows[0]!.id;
}

async function createReservation(
  eventId: string,
  input: { handle: string; linkCode?: string; contactId?: string; stage?: string },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle, party_size,
       terms_accepted_at, idempotency_key, submitted_at, accepted_at, link_code,
       contact_id, stage, on_list_at, paid_at
     ) VALUES ($1, 1, 'CONFIRMED', 'Guest', $2, 1, now(), $3, now(), now(), $4, $5,
               $6, CASE WHEN $6 = 'IN_REVIEW' THEN NULL ELSE now() END,
               CASE WHEN $6 = 'PAID' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      eventId,
      input.handle,
      randomUUID(),
      input.linkCode ?? null,
      input.contactId ?? null,
      input.stage ?? "IN_REVIEW",
    ],
  );
  return result.rows[0]!.id;
}

async function createContact(scopedId: string, lastInboundAt: Date | null = now): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
     VALUES ($1, $2) RETURNING id`,
    [scopedId, lastInboundAt],
  );
  return result.rows[0]!.id;
}

async function createOutbound(
  contactId: string | null,
  input: {
    body?: string;
    status?: string;
    reservationId?: string;
    externalId?: string;
    createdAt?: Date;
  } = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messages (
       contact_id, reservation_id, direction, kind, source, status, body,
       external_message_id, sent_at, created_at
     ) VALUES ($1, $2, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', $3, $4, $5,
       CASE WHEN $3 IN ('SENT', 'READ') THEN COALESCE($6, now()) ELSE NULL END,
       COALESCE($6, now())) RETURNING id`,
    [
      contactId,
      input.reservationId ?? null,
      input.status ?? "QUEUED",
      input.body ?? "mensaje",
      input.externalId ?? null,
      input.createdAt ?? null,
    ],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresMessageRepository(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("Instagram webhook ingestion", () => {
  it("creates one contact and inbound row and ignores a duplicate mid", async () => {
    const sender = `10${Date.now()}`;
    await ingest([inbound(`in-${randomUUID()}`, sender)]);
    const mid = `duplicate-${randomUUID()}`;
    await ingest([inbound(mid, sender, "first")]);
    await ingest([inbound(mid, sender, "second")]);

    const contacts = await pool.query(
      "SELECT id FROM messaging_contacts WHERE instagram_scoped_id = $1",
      [sender],
    );
    const messages = await pool.query<{ body: string }>(
      "SELECT body FROM messages WHERE external_message_id = $1",
      [mid],
    );
    expect(contacts.rowCount).toBe(1);
    expect(messages.rows).toEqual([{ body: "first" }]);
  });

  it("records app echoes, ignores our stored mid, edits and deletes inbound messages", async () => {
    const sender = `20${Date.now()}`;
    const mid = `edit-${randomUUID()}`;
    await ingest([inbound(mid, sender, "old")]);
    await ingest([
      { type: "message_edit", externalMessageId: mid, text: "new", timestamp: now },
      {
        type: "echo",
        externalMessageId: mid,
        recipientId: sender,
        timestamp: now,
        text: "ignored",
        attachmentUrls: [],
      },
      {
        type: "echo",
        externalMessageId: `app-${randomUUID()}`,
        recipientId: sender,
        timestamp: now,
        text: "typed in app",
        attachmentUrls: [],
      },
    ]);
    const rows = await pool.query<{ direction: string; source: string; body: string }>(
      "SELECT direction, source, body FROM messages WHERE contact_id = (SELECT id FROM messaging_contacts WHERE instagram_scoped_id = $1) ORDER BY created_at, id",
      [sender],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { direction: "INBOUND", source: "GUEST", body: "new" },
        { direction: "OUTBOUND", source: "INSTAGRAM_APP", body: "typed in app" },
      ]),
    );

    await ingest([{ type: "deleted", externalMessageId: mid, timestamp: now }]);
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE external_message_id = $1", [mid])).rowCount,
    ).toBe(0);
  });

  it("marks sent rows through the known read mid and falls back to event time", async () => {
    const sender = `30${Date.now()}`;
    const contactId = await createContact(sender);
    const first = await createOutbound(contactId, {
      status: "SENT",
      externalId: `sent-${randomUUID()}`,
      createdAt: new Date("2026-10-30T10:00:00Z"),
    });
    const second = await createOutbound(contactId, {
      status: "SENT",
      externalId: `sent-${randomUUID()}`,
      createdAt: new Date("2026-10-30T11:00:00Z"),
    });
    const firstMid = await pool.query<{ external_message_id: string }>(
      "SELECT external_message_id FROM messages WHERE id = $1",
      [first],
    );
    await ingest([
      {
        type: "read",
        senderId: sender,
        externalMessageId: firstMid.rows[0]!.external_message_id,
        timestamp: now,
      },
    ]);
    const statuses = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM messages WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[first, second]],
    );
    expect(statuses.rows.find((row) => row.id === first)!.status).toBe("READ");
    expect(statuses.rows.find((row) => row.id === second)!.status).toBe("SENT");
  });

  it("links by text code and releases WAITING_CONTACT and WAITING_WINDOW", async () => {
    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, {
      handle: "code.guest",
      linkCode: "ABC234",
    });
    const waitingContact = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         reservation_id, event_id, direction, kind, source, status, body
       ) VALUES ($1, $2, 'OUTBOUND', 'REQUEST_RECEIVED', 'SYSTEM', 'WAITING_CONTACT', 'pending')
       RETURNING id`,
      [reservationId, eventId],
    );
    const sender = `40${Date.now()}`;
    const contactId = await createContact(sender, new Date("2026-10-28T00:00:00Z"));
    const waitingWindow = await createOutbound(contactId, { status: "WAITING_WINDOW" });
    await ingest([inbound(`code-${randomUUID()}`, sender, "mi código es ABC234")]);

    const reservation = await pool.query<{ contact_id: string }>(
      "SELECT contact_id FROM reservations WHERE id = $1",
      [reservationId],
    );
    const statuses = await pool.query<{ id: string; status: string; contact_id: string }>(
      "SELECT id, status, contact_id FROM messages WHERE id = ANY($1::uuid[])",
      [[waitingContact.rows[0]!.id, waitingWindow]],
    );
    expect(reservation.rows[0]!.contact_id).toBe(contactId);
    expect(
      statuses.rows.every((row) => row.status === "QUEUED" && row.contact_id === contactId),
    ).toBe(true);
  });

  it("links a request from a standalone referral code", async () => {
    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, {
      handle: "referral.guest",
      linkCode: "DEF235",
    });
    const sender = `45${Date.now()}`;
    await ingest([{ type: "referral", senderId: sender, ref: "DEF235", timestamp: now }]);
    const linked = await pool.query<{ instagram_scoped_id: string }>(
      `SELECT c.instagram_scoped_id
         FROM reservations r JOIN messaging_contacts c ON c.id = r.contact_id
        WHERE r.id = $1`,
      [reservationId],
    );
    expect(linked.rows[0]!.instagram_scoped_id).toBe(sender);
  });

  it("links one username across two live events but not a deleted event", async () => {
    const [eventA, eventB, deletedEvent] = await Promise.all([
      createEvent(),
      createEvent(),
      createEvent({ deleted: true }),
    ]);
    const ids = await Promise.all(
      [eventA, eventB, deletedEvent].map((eventId) =>
        createReservation(eventId, { handle: "same.guest" }),
      ),
    );
    const sender = `50${Date.now()}`;
    const messenger = fakeMessenger({
      fetchProfile: vi.fn(async () => ({ username: "Same.Guest", name: "Same Guest" })),
    });
    const result = await ingest([inbound(`profile-${randomUUID()}`, sender)], messenger);
    await result.after();

    const linked = await pool.query<{ id: string; contact_id: string | null }>(
      "SELECT id, contact_id FROM reservations WHERE id = ANY($1::uuid[]) ORDER BY id",
      [ids],
    );
    expect(linked.rows.filter((row) => row.contact_id !== null)).toHaveLength(2);
    expect(linked.rows.find((row) => row.id === ids[2])!.contact_id).toBeNull();
  });

  it("stores downloaded inbound images by original attachment position", async () => {
    const sender = `60${Date.now()}`;
    const messenger = fakeMessenger();
    const externalMessageId = `image-${randomUUID()}`;
    const result = await ingest(
      [
        inbound(externalMessageId, sender, null, {
          attachmentUrls: ["https://example.com/video", "https://example.com/image"],
          imageAttachmentUrls: ["https://example.com/image"],
        }),
      ],
      messenger,
      { [sender]: "image.guest" },
    );
    await result.after();
    const attachment = await pool.query<{ position: number; content_type: string }>(
      `SELECT a.position, a.content_type
         FROM message_attachments a JOIN messages m ON m.id = a.message_id
        WHERE m.external_message_id = $1`,
      [externalMessageId],
    );
    expect(attachment.rows).toEqual([{ position: 1, content_type: "image/png" }]);
  });
});

describe("PostgreSQL message delivery", () => {
  it("preserves per-contact order and fences a stale lease", async () => {
    const contactId = await createContact(`70${Date.now()}`);
    const first = await createOutbound(contactId, { createdAt: new Date("2026-10-30T10:00:00Z") });
    const second = await createOutbound(contactId, { createdAt: new Date("2026-10-30T10:01:00Z") });
    const firstClaim = await repository.claimDue(10, [first, second]);
    expect(firstClaim.map((row) => row.id)).toContain(first);
    expect(firstClaim.map((row) => row.id)).not.toContain(second);

    await pool.query(
      "UPDATE messages SET locked_until = locked_until + interval '1 second' WHERE id = $1",
      [first],
    );
    await pool.query(
      `INSERT INTO messages (
         contact_id, direction, kind, source, status, body, external_message_id, sent_at
       ) VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'INSTAGRAM_APP', 'SENT', 'echo', 'stale-mid', now())`,
      [contactId],
    );
    await expect(
      repository.markSent(
        first,
        firstClaim.find((row) => row.id === first)!.lockedUntil,
        "stale-mid",
      ),
    ).resolves.toBe(false);
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE external_message_id = 'stale-mid'")).rowCount,
    ).toBe(1);
    await pool.query("UPDATE messages SET locked_until = NULL WHERE id = $1", [first]);
    const reclaimed = await repository.claimDue(1, [first]);
    await repository.markSent(first, reclaimed[0]!.lockedUntil, "ordered-mid");
    expect((await repository.claimDue(1, [second])).map((row) => row.id)).toContain(second);
  });

  it("replaces an early app echo when markSent completes", async () => {
    const sender = `80${Date.now()}`;
    const contactId = await createContact(sender);
    const queued = await createOutbound(contactId);
    const [claim] = await repository.claimDue(1, [queued]);
    const mid = `early-${randomUUID()}`;
    await ingest([
      {
        type: "echo",
        externalMessageId: mid,
        recipientId: sender,
        text: "echo",
        attachmentUrls: [],
        timestamp: now,
      },
    ]);
    await expect(repository.markSent(queued, claim!.lockedUntil, mid)).resolves.toBe(true);
    const rows = await pool.query<{ id: string; source: string; status: string }>(
      "SELECT id, source, status FROM messages WHERE external_message_id = $1",
      [mid],
    );
    expect(rows.rows).toEqual([{ id: queued, source: "ADMIN", status: "SENT" }]);
  });

  it("delivers and exposes conversation read models", async () => {
    const sender = `90${Date.now()}`;
    const contactId = await createContact(sender);
    const messageId = await createOutbound(contactId, { body: "hello from admin" });
    const messenger = fakeMessenger({ sendText: vi.fn(async () => ({ messageId: "sent-mid" })) });
    const summary = await deliverMessagesNow(
      {
        repository,
        messenger,
        now: () => now.getTime(),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [messageId],
      { timeBudgetMs: 1000 },
    );
    expect(summary.outcomes[messageId]).toBe("SENT");

    await ingest([inbound(`unread-${randomUUID()}`, sender, "guest reply")]);
    const listed = await repository.listConversations({ page: 1, pageSize: 100 });
    expect(listed.items.find((item) => item.contactId === contactId)).toMatchObject({
      contactId,
      unreadCount: 1,
    });
    const detail = await repository.getConversation(contactId);
    expect(detail!.messages.map((message) => message.body)).toEqual(
      expect.arrayContaining(["hello from admin", "guest reply"]),
    );
    expect(await repository.countUnreadConversations()).toBeGreaterThan(0);
    await repository.markConversationRead(contactId);
    const read = await repository.listConversations({ page: 1, pageSize: 100 });
    expect(read.items.find((item) => item.contactId === contactId)!.unreadCount).toBe(0);
  });

  it("persists window, retry, fail and relevance outcomes", async () => {
    const closedContact = await createContact(`91${Date.now()}`, new Date("2026-10-28T00:00:00Z"));
    const closed = await createOutbound(closedContact);
    const windowContact = await createContact(`92${Date.now()}`);
    const outsideWindow = await createOutbound(windowContact);
    const retryContact = await createContact(`93${Date.now()}`);
    const retry = await createOutbound(retryContact);
    const failContact = await createContact(`94${Date.now()}`);
    const fail = await createOutbound(failContact);

    const run = (id: string, messenger: InstagramMessenger) =>
      deliverMessagesNow(
        {
          repository,
          messenger,
          now: () => now.getTime(),
          logFailure: vi.fn(),
          logStaleLease: vi.fn(),
        },
        [id],
        { timeBudgetMs: 1000 },
      );

    await run(closed, fakeMessenger());
    await run(
      outsideWindow,
      fakeMessenger({
        sendText: vi.fn(async () => {
          throw new MessengerError("outside", { status: 400, code: 10, subcode: 2534022 });
        }),
      }),
    );
    await run(
      retry,
      fakeMessenger({
        sendText: vi.fn(async () => {
          throw new MessengerError("server", { status: 500 });
        }),
      }),
    );
    await run(
      fail,
      fakeMessenger({
        sendText: vi.fn(async () => {
          throw new MessengerError("bad", { status: 400, code: 42 });
        }),
      }),
    );

    const statuses = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM messages WHERE id = ANY($1::uuid[])",
      [[closed, outsideWindow, retry, fail]],
    );
    expect(statuses.rows.find((row) => row.id === closed)!.status).toBe("WAITING_WINDOW");
    expect(statuses.rows.find((row) => row.id === outsideWindow)!.status).toBe("WAITING_WINDOW");
    expect(statuses.rows.find((row) => row.id === retry)!.status).toBe("QUEUED");
    expect(statuses.rows.find((row) => row.id === fail)!.status).toBe("FAILED");

    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, {
      handle: "irrelevant.guest",
      contactId: failContact,
    });
    await pool.query(
      "UPDATE reservations SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
      [reservationId],
    );
    const irrelevant = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, reservation_id, event_id, direction, kind, source, status, body
       ) VALUES ($1, $2, $3, 'OUTBOUND', 'REQUEST_RECEIVED', 'SYSTEM', 'QUEUED', 'old')
       RETURNING id`,
      [failContact, reservationId, eventId],
    );
    await run(irrelevant.rows[0]!.id, fakeMessenger());
    expect(await repository.getStatus(irrelevant.rows[0]!.id)).toBe("DISCARDED");
  });
});

describe("admin message use cases", () => {
  it("sends free text and supports retry, manual, discard, link and unlink", async () => {
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Messaging Admin') RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    const adminId = admin.rows[0]!.id;
    const contactId = await createContact(`95${Date.now()}`);
    const messenger = fakeMessenger({ sendText: vi.fn(async () => ({ messageId: "admin-mid" })) });
    const deliver = (ids: readonly string[]) =>
      deliverMessagesNow(
        {
          repository,
          messenger,
          now: () => now.getTime(),
          logFailure: vi.fn(),
          logStaleLease: vi.fn(),
        },
        ids,
        { timeBudgetMs: 1000 },
      );
    const sent = await sendFreeText(
      { repository, consumeRateLimit: async () => ({ allowed: true }), deliver },
      contactId,
      "respuesta",
      adminId,
    );
    expect(sent).toMatchObject({ ok: true, status: "SENT" });

    const failed = await createOutbound(contactId, { status: "FAILED" });
    expect(await retryMessage(repository, failed)).toBe(true);
    expect(await markSentManually(repository, failed, adminId)).toBe(true);
    const pending = await createOutbound(contactId);
    expect(await discardMessage(repository, pending, adminId)).toBe(true);

    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, { handle: "manual.guest" });
    expect(await linkContact(repository, contactId, { reservationId }, adminId)).toBe(true);
    expect(await unlinkContact(repository, contactId, { reservationId }, adminId)).toBe(true);
    const reservation = await pool.query<{ contact_id: string | null }>(
      "SELECT contact_id FROM reservations WHERE id = $1",
      [reservationId],
    );
    expect(reservation.rows[0]!.contact_id).toBeNull();
  });
});
