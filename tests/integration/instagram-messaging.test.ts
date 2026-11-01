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
  linkContactByCode,
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
  input: {
    handle: string;
    linkCode?: string;
    contactId?: string;
    stage?: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle, party_size,
       terms_accepted_at, idempotency_key, submitted_at, accepted_at, link_code,
       contact_id, contact_linked_by, stage, on_list_at, paid_at
     ) VALUES ($1, 1, 'CONFIRMED', 'Guest', $2, 1, now(), $3, now(), now(), $4, $5,
               CASE WHEN $5::uuid IS NULL THEN NULL ELSE 'MANUAL' END,
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
    const messages = await pool.query<{ body: string; created_at: Date; received_at: Date }>(
      "SELECT body, created_at, received_at FROM messages WHERE external_message_id = $1",
      [mid],
    );
    expect(contacts.rowCount).toBe(1);
    expect(messages.rows[0]!.body).toBe("first");
    expect(messages.rows[0]!.created_at.toISOString()).toBe(now.toISOString());
    expect(messages.rows[0]!.received_at.getTime()).toBeGreaterThan(now.getTime());
  });

  it("never creates a contact for the configured account id", async () => {
    const accountId = `11${Date.now()}`;
    const guardedRepository = new PostgresMessageRepository(pool, accountId);

    const result = await guardedRepository.ingestEvents([
      inbound(`self-${randomUUID()}`, accountId),
    ]);

    expect(result.contacts).toEqual([]);
    expect(
      await pool.query("SELECT 1 FROM messaging_contacts WHERE instagram_scoped_id = $1", [
        accountId,
      ]),
    ).toHaveProperty("rowCount", 0);
  });

  it("records app echoes, ignores our stored mid, edits and deletes inbound messages", async () => {
    const sender = `20${Date.now()}`;
    const mid = `edit-${randomUUID()}`;
    await ingest([inbound(mid, sender, "old")]);
    await ingest([
      {
        type: "message_edit",
        externalMessageId: mid,
        text: "new",
        timestamp: now,
      },
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
    const rows = await pool.query<{
      direction: string;
      source: string;
      body: string;
    }>(
      "SELECT direction, source, body FROM messages WHERE contact_id = (SELECT id FROM messaging_contacts WHERE instagram_scoped_id = $1) ORDER BY created_at, id",
      [sender],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { direction: "INBOUND", source: "GUEST", body: "new" },
        {
          direction: "OUTBOUND",
          source: "INSTAGRAM_APP",
          body: "typed in app",
        },
      ]),
    );

    await ingest([
      {
        type: "deleted",
        senderId: sender,
        externalMessageId: mid,
        timestamp: now,
      },
    ]);
    const tombstone = await pool.query<{ body: string }>(
      "SELECT body FROM messages WHERE external_message_id = $1",
      [mid],
    );
    expect(tombstone.rows).toEqual([{ body: "[mensaje eliminado]" }]);
  });

  it("inserts an unsend tombstone first and never resurrects it on redelivery", async () => {
    const sender = `21${Date.now()}`;
    const mid = `deleted-first-${randomUUID()}`;
    await ingest([
      {
        type: "deleted",
        senderId: sender,
        externalMessageId: mid,
        timestamp: now,
      },
    ]);
    await ingest([inbound(mid, sender, "contenido tardío")]);

    const row = await pool.query<{
      body: string;
      attachment_urls: string[] | null;
    }>("SELECT body, attachment_urls FROM messages WHERE external_message_id = $1", [mid]);
    expect(row.rows).toEqual([{ body: "[mensaje eliminado]", attachment_urls: null }]);
  });

  it("does not move last_inbound_at for a deletion", async () => {
    const sender = `211${Date.now()}`;
    const originalInbound = new Date("2026-10-29T10:00:00Z");
    await createContact(sender, originalInbound);

    await ingest([
      {
        type: "deleted",
        senderId: sender,
        externalMessageId: `deleted-window-${randomUUID()}`,
        timestamp: new Date("2026-10-31T10:00:00Z"),
      },
    ]);

    const contact = await pool.query<{ last_inbound_at: Date }>(
      "SELECT last_inbound_at FROM messaging_contacts WHERE instagram_scoped_id = $1",
      [sender],
    );
    expect(contact.rows[0]!.last_inbound_at.toISOString()).toBe(originalInbound.toISOString());
  });

  it("rolls back one invalid event to its savepoint and continues the batch", async () => {
    const sender = `22${Date.now()}`;
    const goodMid = `good-after-bad-${randomUUID()}`;
    await ingest([
      {
        type: "echo",
        externalMessageId: `bad-${randomUUID()}`,
        recipientId: sender,
        timestamp: now,
        text: "x".repeat(2001),
        attachmentUrls: [],
      },
      inbound(goodMid, sender, "válido"),
    ]);

    const rows = await pool.query<{ body: string }>(
      "SELECT body FROM messages WHERE external_message_id = $1",
      [goodMid],
    );
    expect(rows.rows).toEqual([{ body: "válido" }]);
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
    const waitingWindow = await createOutbound(contactId, {
      status: "WAITING_WINDOW",
    });
    await ingest([inbound(`code-${randomUUID()}`, sender, "mi código es ABC234")]);

    const reservation = await pool.query<{ contact_id: string }>(
      "SELECT contact_id FROM reservations WHERE id = $1",
      [reservationId],
    );
    const statuses = await pool.query<{
      id: string;
      status: string;
      contact_id: string;
    }>("SELECT id, status, contact_id FROM messages WHERE id = ANY($1::uuid[])", [
      [waitingContact.rows[0]!.id, waitingWindow],
    ]);
    expect(reservation.rows[0]!.contact_id).toBe(contactId);
    expect(
      statuses.rows.every((row) => row.status === "QUEUED" && row.contact_id === contactId),
    ).toBe(true);
  });

  it("lets code replace USERNAME links but never CODE or MANUAL links", async () => {
    const eventId = await createEvent();
    const usernameContact = await createContact(`41${Date.now()}`);
    const replaceable = await createReservation(eventId, {
      handle: "replaceable.guest",
      linkCode: "GHJ236",
      contactId: usernameContact,
    });
    await pool.query("UPDATE reservations SET contact_linked_by = 'USERNAME' WHERE id = $1", [
      replaceable,
    ]);
    const failed = await createOutbound(usernameContact, {
      status: "FAILED",
      reservationId: replaceable,
    });
    const sender = `42${Date.now()}`;
    await ingest([inbound(`replace-${randomUUID()}`, sender, "GHJ236")]);
    const newContact = await pool.query<{ id: string }>(
      "SELECT id FROM messaging_contacts WHERE instagram_scoped_id = $1",
      [sender],
    );
    const replaced = await pool.query<{
      contact_id: string;
      contact_linked_by: string;
    }>("SELECT contact_id, contact_linked_by FROM reservations WHERE id = $1", [replaceable]);
    expect(replaced.rows[0]).toEqual({
      contact_id: newContact.rows[0]!.id,
      contact_linked_by: "CODE",
    });
    expect(
      await pool.query(
        "SELECT 1 FROM messages WHERE id = $1 AND contact_id = $2 AND status = 'FAILED'",
        [failed, newContact.rows[0]!.id],
      ),
    ).toHaveProperty("rowCount", 1);

    const manualContact = await createContact(`43${Date.now()}`);
    const protectedReservation = await createReservation(await createEvent(), {
      handle: "manual.guest",
      linkCode: "KLM237",
      contactId: manualContact,
    });
    await ingest([inbound(`protected-${randomUUID()}`, sender, "KLM237")]);
    const protectedRow = await pool.query<{
      contact_id: string;
      contact_linked_by: string;
    }>("SELECT contact_id, contact_linked_by FROM reservations WHERE id = $1", [
      protectedReservation,
    ]);
    expect(protectedRow.rows[0]).toEqual({
      contact_id: manualContact,
      contact_linked_by: "MANUAL",
    });
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

  it("does not auto-link an ambiguous username across two live events", async () => {
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
      fetchProfile: vi.fn(async () => ({
        username: "Same.Guest",
        name: "Same Guest",
      })),
    });
    const result = await ingest([inbound(`profile-${randomUUID()}`, sender)], messenger);
    await result.after();

    const linked = await pool.query<{ id: string; contact_id: string | null }>(
      "SELECT id, contact_id FROM reservations WHERE id = ANY($1::uuid[]) ORDER BY id",
      [ids],
    );
    expect(linked.rows.filter((row) => row.contact_id !== null)).toHaveLength(0);
    expect(linked.rows.find((row) => row.id === ids[2])!.contact_id).toBeNull();
  });

  it("auto-links exactly one guest-one match and never a guest-two-only match", async () => {
    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, {
      handle: "guest.one",
    });
    await pool.query(
      `UPDATE reservations
          SET party_size = 2, guest2_full_name = 'Guest Two',
              guest2_instagram_handle = 'guest.two'
        WHERE id = $1`,
      [reservationId],
    );
    const guestTwoContact = await createContact(`55${Date.now()}`);
    expect(await repository.linkByUsername(guestTwoContact, "guest.two")).toBe(false);

    const guestOneContact = await createContact(`56${Date.now()}`);
    expect(await repository.linkByUsername(guestOneContact, "guest.one")).toBe(false);
    const linked = await pool.query<{
      contact_id: string;
      contact_linked_by: string;
    }>("SELECT contact_id, contact_linked_by FROM reservations WHERE id = $1", [reservationId]);
    expect(linked.rows[0]).toEqual({
      contact_id: guestOneContact,
      contact_linked_by: "USERNAME",
    });
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
    const attachment = await pool.query<{
      position: number;
      content_type: string;
    }>(
      `SELECT a.position, a.content_type
         FROM message_attachments a JOIN messages m ON m.id = a.message_id
        WHERE m.external_message_id = $1`,
      [externalMessageId],
    );
    expect(attachment.rows).toEqual([{ position: 1, content_type: "image/png" }]);
  });

  it("lets an unsend tombstone win against an in-flight image download", async () => {
    const sender = `601${Date.now()}`;
    const externalMessageId = `image-unsend-${randomUUID()}`;
    let releaseDownload!: () => void;
    const downloadReleased = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    let notifyStarted!: () => void;
    const downloadStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const result = await ingest(
      [
        inbound(externalMessageId, sender, null, {
          attachmentUrls: ["https://lookaside.fbsbx.com/receipt"],
          imageAttachmentUrls: ["https://lookaside.fbsbx.com/receipt"],
        }),
      ],
      fakeMessenger({
        downloadImage: vi.fn(async () => {
          notifyStarted();
          await downloadReleased;
          return {
            contentType: "image/png",
            data: Buffer.from("89504e470d0a1a0a", "hex"),
          };
        }),
      }),
      { [sender]: "unsend.guest" },
    );

    const followup = result.after();
    await downloadStarted;
    await ingest([
      {
        type: "deleted",
        senderId: sender,
        externalMessageId,
        timestamp: now,
      },
    ]);
    releaseDownload();
    await followup;

    const attachments = await pool.query(
      `SELECT 1
         FROM message_attachments a
         JOIN messages m ON m.id = a.message_id
        WHERE m.external_message_id = $1`,
      [externalMessageId],
    );
    expect(attachments.rowCount).toBe(0);
  });

  it("retries missing inbound images and skips permanent failures", async () => {
    const sender = `61${Date.now()}`;
    const imageUrl = "https://lookaside.fbsbx.com/receipt";
    const transient = fakeMessenger({
      downloadImage: vi.fn().mockRejectedValueOnce(new MessengerError("network", { status: null })),
    });
    const first = await ingest(
      [
        inbound(`retry-image-${randomUUID()}`, sender, null, {
          attachmentUrls: [imageUrl],
          imageAttachmentUrls: [imageUrl],
        }),
      ],
      transient,
    );
    await first.after();

    const retryMessenger = fakeMessenger();
    const retry = await ingest([], retryMessenger);
    await retry.after();
    expect(retryMessenger.downloadImage).toHaveBeenCalledWith(imageUrl);

    const permanentUrl = "https://lookaside.fbsbx.com/not-image";
    const permanent = fakeMessenger({
      downloadImage: vi.fn().mockRejectedValue(new MessengerError("not image", { status: 415 })),
    });
    const failed = await ingest(
      [
        inbound(`permanent-image-${randomUUID()}`, sender, null, {
          attachmentUrls: [permanentUrl],
          imageAttachmentUrls: [permanentUrl],
        }),
      ],
      permanent,
    );
    await failed.after();
    vi.mocked(permanent.downloadImage).mockClear();
    const skipped = await ingest([], permanent);
    await skipped.after();
    expect(permanent.downloadImage).not.toHaveBeenCalled();
  });

  it("orders missing inbound image candidates newest first", async () => {
    const contactId = await createContact(`62${Date.now()}`);
    const older = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, direction, kind, source, status, body, attachment_urls,
         received_at, created_at
       ) VALUES ($1, 'INBOUND', 'INBOUND', 'GUEST', 'RECEIVED', NULL,
                 ARRAY['https://lookaside.fbsbx.com/older'],
                 '2098-01-01T00:00:00Z', '2098-01-01T00:00:00Z')
       RETURNING id`,
      [contactId],
    );
    const newer = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, direction, kind, source, status, body, attachment_urls,
         received_at, created_at
       ) VALUES ($1, 'INBOUND', 'INBOUND', 'GUEST', 'RECEIVED', NULL,
                 ARRAY['https://lookaside.fbsbx.com/newer'],
                 '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z')
       RETURNING id`,
      [contactId],
    );

    const candidates = await repository.listMissingInboundImages(2);

    expect(candidates.map((candidate) => candidate.messageId)).toEqual([
      newer.rows[0]!.id,
      older.rows[0]!.id,
    ]);
  });
});

describe("PostgreSQL message delivery", () => {
  it("self-heals WAITING_CONTACT rows and retry resolves the subject contact", async () => {
    const contactId = await createContact(`69${Date.now()}`);
    const reservationId = await createReservation(await createEvent(), {
      handle: "self.heal",
    });
    const waiting = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         reservation_id, direction, kind, source, status, body
       ) VALUES ($1, 'OUTBOUND', 'REQUEST_RECEIVED', 'SYSTEM', 'WAITING_CONTACT', 'heal')
       RETURNING id`,
      [reservationId],
    );
    await pool.query(
      `UPDATE reservations
          SET contact_id = $2, contact_linked_by = 'MANUAL'
        WHERE id = $1`,
      [reservationId, contactId],
    );
    const messenger = fakeMessenger({
      sendText: vi.fn(async () => ({ messageId: "heal-mid" })),
    });
    const summary = await deliverMessagesNow(
      {
        repository,
        messenger,
        now: () => now.getTime(),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [waiting.rows[0]!.id],
      { timeBudgetMs: 1000 },
    );
    expect(summary.outcomes[waiting.rows[0]!.id]).toBe("SENT");

    const staleContact = await createContact(`690${Date.now()}`);
    const retryable = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, reservation_id, direction, kind, source, status, body,
         parts_sent, external_part_ids, attempts
       ) VALUES ($1, $2, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'FAILED', 'retry',
                 1, ARRAY['stale-mid'], 4)
       RETURNING id`,
      [staleContact, reservationId],
    );
    await expect(repository.retryMessage(retryable.rows[0]!.id)).resolves.toBe("UPDATED");
    const retried = await pool.query<{
      contact_id: string;
      status: string;
      parts_sent: number;
      external_part_ids: string[] | null;
      attempts: number;
    }>(
      `SELECT contact_id, status, parts_sent, external_part_ids, attempts
         FROM messages WHERE id = $1`,
      [retryable.rows[0]!.id],
    );
    expect(retried.rows[0]).toEqual({
      contact_id: contactId,
      status: "QUEUED",
      parts_sent: 0,
      external_part_ids: null,
      attempts: 0,
    });
  });

  it("repairs reservation and waitlist contacts with primary-key updates", async () => {
    const staleContact = await createContact(`6901${Date.now()}`);
    const currentContact = await createContact(`6902${Date.now()}`);
    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, {
      handle: "repair.reservation",
      contactId: currentContact,
    });
    const waitlist = await pool.query<{ id: string }>(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle, party_size,
         terms_accepted_at, idempotency_key, submitted_at, contact_id, contact_linked_by
       ) VALUES ($1, 1, 'WAITING', 'Repair Guest', 'repair.waitlist', 1,
                 clock_timestamp(), $2, clock_timestamp(), $3, 'MANUAL')
       RETURNING id`,
      [eventId, randomUUID(), currentContact],
    );
    const messages = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, reservation_id, waitlist_entry_id, direction, kind, source, status,
         body, parts_sent, external_part_ids, attempts
       ) VALUES
         ($1, $2, NULL, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'WAITING_CONTACT',
          'reservation repair', 1, ARRAY['reservation-mid'], 3),
         ($1, NULL, $3, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'WAITING_CONTACT',
          'waitlist repair', 1, ARRAY['waitlist-mid'], 3)
       RETURNING id`,
      [staleContact, reservationId, waitlist.rows[0]!.id],
    );

    await expect(repository.repairWaitingContacts()).resolves.toBe(2);

    const repaired = await pool.query<{
      id: string;
      contact_id: string;
      status: string;
      parts_sent: number;
      external_part_ids: string[] | null;
      attempts: number;
    }>(
      `SELECT id, contact_id, status, parts_sent, external_part_ids, attempts
         FROM messages WHERE id = ANY($1::uuid[])`,
      [messages.rows.map((row) => row.id)],
    );
    expect(repaired.rows).toHaveLength(2);
    expect(repaired.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contact_id: currentContact,
          status: "QUEUED",
          parts_sent: 0,
          external_part_ids: null,
          attempts: 0,
        }),
        expect.objectContaining({
          contact_id: currentContact,
          status: "QUEUED",
          parts_sent: 0,
          external_part_ids: null,
          attempts: 0,
        }),
      ]),
    );
  });

  it("resets a partially sent LOCATION when retargeted and sends every part to the new contact", async () => {
    const oldContact = await createContact(`691${Date.now()}`);
    const newRecipient = `692${Date.now()}`;
    const newContact = await createContact(newRecipient);
    const eventId = await createEvent();
    await pool.query(
      `UPDATE events
          SET location_status = 'CONFIRMED', location_address = 'Calle 1',
              location_confirmed_at = clock_timestamp(), location_revision = 1
        WHERE id = $1`,
      [eventId],
    );
    const reservationId = await createReservation(eventId, {
      handle: "retarget.location",
      contactId: oldContact,
      stage: "PAID",
    });
    const message = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, reservation_id, event_id, direction, kind, source, status, body,
         attachment_urls, location_revision, parts_sent, external_part_ids, attempts
       ) VALUES (
         $1, $2, $3, 'OUTBOUND', 'LOCATION', 'SYSTEM', 'QUEUED', 'ubicación',
         ARRAY['https://example.com/one.jpg', 'https://example.com/two.jpg'], 1, 2,
         ARRAY['old-text', 'old-image'], 4
       ) RETURNING id`,
      [oldContact, reservationId, eventId],
    );
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Retarget Admin') RETURNING id`,
      [`retarget-${randomUUID()}@example.com`],
    );

    await expect(
      repository.linkContact(newContact, { reservationId }, admin.rows[0]!.id),
    ).resolves.toBe(true);
    const reset = await pool.query<{
      contact_id: string;
      parts_sent: number;
      external_part_ids: string[] | null;
      attempts: number;
    }>(
      `SELECT contact_id, parts_sent, external_part_ids, attempts
         FROM messages WHERE id = $1`,
      [message.rows[0]!.id],
    );
    expect(reset.rows[0]).toEqual({
      contact_id: newContact,
      parts_sent: 0,
      external_part_ids: null,
      attempts: 0,
    });

    const sendText = vi.fn(async () => ({ messageId: "new-text" }));
    const sendImage = vi
      .fn()
      .mockResolvedValueOnce({ messageId: "new-image-1" })
      .mockResolvedValueOnce({ messageId: "new-image-2" });
    const summary = await deliverMessagesNow(
      {
        repository,
        messenger: fakeMessenger({ sendText, sendImage }),
        now: () => now.getTime(),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [message.rows[0]!.id],
      { timeBudgetMs: 1000 },
    );

    expect(summary.outcomes[message.rows[0]!.id]).toBe("SENT");
    expect(sendText).toHaveBeenCalledWith(newRecipient, "ubicación");
    expect(sendImage.mock.calls).toEqual([
      [newRecipient, "https://example.com/one.jpg"],
      [newRecipient, "https://example.com/two.jpg"],
    ]);
  });

  it("re-resolves a zero-progress leased row from the subject before sending", async () => {
    const oldContact = await createContact(`693${Date.now()}`);
    const newRecipient = `694${Date.now()}`;
    const newContact = await createContact(newRecipient);
    const reservationId = await createReservation(await createEvent(), {
      handle: "lease.retarget",
      contactId: oldContact,
    });
    const messageId = await createOutbound(oldContact, { reservationId });
    await repository.claimDue(1, [messageId]);
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Lease Retarget Admin') RETURNING id`,
      [`lease-retarget-${randomUUID()}@example.com`],
    );
    await repository.linkContact(newContact, { reservationId }, admin.rows[0]!.id);
    const newerMessage = await createOutbound(newContact, {
      body: "newer",
      createdAt: new Date("2099-10-30T13:00:00Z"),
    });
    await expect(repository.claimDue(1, [newerMessage])).resolves.toEqual([]);
    await pool.query(
      "UPDATE messages SET locked_until = clock_timestamp() - interval '1 second' WHERE id = $1",
      [messageId],
    );
    const sendText = vi.fn(async () => ({ messageId: "retargeted-mid" }));

    await deliverMessagesNow(
      {
        repository,
        messenger: fakeMessenger({ sendText }),
        now: () => now.getTime(),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [messageId],
      { timeBudgetMs: 1000 },
    );

    expect(sendText).toHaveBeenCalledWith(newRecipient, "mensaje");
  });

  it("fails a fifth no-progress claim and continues with the next contact message", async () => {
    const contactId = await createContact(`695${Date.now()}`);
    const stalled = await createOutbound(contactId, {
      body: "stalled",
      createdAt: new Date("2026-10-30T09:00:00Z"),
    });
    const next = await createOutbound(contactId, {
      body: "next",
      createdAt: new Date("2026-10-30T09:01:00Z"),
    });
    await pool.query("UPDATE messages SET claims_without_progress = 5 WHERE id = $1", [stalled]);
    const sendText = vi.fn(async () => ({ messageId: "next-mid" }));

    await deliverMessagesNow(
      {
        repository,
        messenger: fakeMessenger({ sendText }),
        now: () => now.getTime(),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [next],
      { timeBudgetMs: 1000 },
    );

    const rows = await pool.query<{
      id: string;
      status: string;
      last_error: string | null;
      claims_without_progress: number;
    }>(
      `SELECT id, status, last_error, claims_without_progress
         FROM messages WHERE id = ANY($1::uuid[])`,
      [[stalled, next]],
    );
    expect(rows.rows.find((row) => row.id === stalled)).toMatchObject({
      status: "FAILED",
      last_error: "NO_PROGRESS",
      claims_without_progress: 0,
    });
    expect(rows.rows.find((row) => row.id === next)).toMatchObject({
      status: "SENT",
      claims_without_progress: 0,
    });
    expect(sendText).toHaveBeenCalledOnce();
    expect(sendText).toHaveBeenCalledWith(expect.any(String), "next");
  });

  it("keeps seven Meta 5xx failures queued and fails the eighth with the provider error", async () => {
    const contactId = await createContact(`696${Date.now()}`);
    const messageId = await createOutbound(contactId, { body: "retry eight times" });
    const sendText = vi.fn(async () => {
      throw new MessengerError("server", { status: 500 });
    });
    const run = () =>
      deliverMessagesNow(
        {
          repository,
          messenger: fakeMessenger({ sendText }),
          now: () => now.getTime(),
          logFailure: vi.fn(),
          logStaleLease: vi.fn(),
        },
        [messageId],
        { timeBudgetMs: 1000 },
      );
    const state = () =>
      pool.query<{
        status: string;
        attempts: number;
        last_error: string | null;
        claims_without_progress: number;
      }>(
        `SELECT status, attempts, last_error, claims_without_progress
           FROM messages WHERE id = $1`,
        [messageId],
      );

    for (let attempt = 1; attempt <= 7; attempt += 1) {
      await pool.query("UPDATE messages SET next_attempt_at = clock_timestamp() WHERE id = $1", [
        messageId,
      ]);
      await expect(run()).resolves.toMatchObject({ retried: 1, failed: 0 });
      expect((await state()).rows[0]).toEqual({
        status: "QUEUED",
        attempts: attempt,
        last_error: "HTTP_500",
        claims_without_progress: 0,
      });
    }

    await pool.query("UPDATE messages SET next_attempt_at = clock_timestamp() WHERE id = $1", [
      messageId,
    ]);
    await expect(run()).resolves.toMatchObject({ retried: 0, failed: 1 });
    expect((await state()).rows[0]).toEqual({
      status: "FAILED",
      attempts: 8,
      last_error: "HTTP_500",
      claims_without_progress: 0,
    });
    expect(sendText).toHaveBeenCalledTimes(8);
  });

  it("releases a deadline-stopped claim without counting no progress", async () => {
    const contactId = await createContact(`698${Date.now()}`);
    const messageId = await createOutbound(contactId, { body: "next drain" });
    const sendText = vi.fn(async () => ({ messageId: "unexpected" }));
    let clockCalls = 0;

    const summary = await deliverMessagesNow(
      {
        repository,
        messenger: fakeMessenger({ sendText }),
        now: () => now.getTime() + (clockCalls++ < 3 ? 0 : 1_000),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [messageId],
      { timeBudgetMs: 1_000 },
    );

    expect(summary.outcomes[messageId]).toBe("QUEUED");
    expect(sendText).not.toHaveBeenCalled();
    const state = await pool.query<{
      status: string;
      locked_until: Date | null;
      claims_without_progress: number;
      due: boolean;
    }>(
      `SELECT status, locked_until, claims_without_progress,
              next_attempt_at <= clock_timestamp() AS due
         FROM messages WHERE id = $1`,
      [messageId],
    );
    expect(state.rows[0]).toEqual({
      status: "QUEUED",
      locked_until: null,
      claims_without_progress: 0,
      due: true,
    });
  });

  it("preserves per-contact order and fences a stale lease", async () => {
    const contactId = await createContact(`70${Date.now()}`);
    const first = await createOutbound(contactId, {
      createdAt: new Date("2026-10-30T10:00:00Z"),
    });
    const second = await createOutbound(contactId, {
      createdAt: new Date("2026-10-30T10:01:00Z"),
    });
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
      repository.recordPart(
        first,
        firstClaim.find((row) => row.id === first)!.lockedUntil,
        "stale-mid",
        true,
      ),
    ).resolves.toBe(false);
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE external_message_id = 'stale-mid'")).rowCount,
    ).toBe(1);
    await pool.query("UPDATE messages SET locked_until = NULL WHERE id = $1", [first]);
    const reclaimed = await repository.claimDue(1, [first]);
    const extended = await repository.extendLease(first, reclaimed[0]!.lockedUntil);
    await repository.recordPart(first, extended!, "ordered-mid", true);
    expect((await repository.claimDue(1, [second])).map((row) => row.id)).toContain(second);
  });

  it("claims a target despite many WAITING_WINDOW rows for other contacts", async () => {
    await pool.query(
      `WITH contacts AS (
         INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
         SELECT $1 || lpad(series::text, 3, '0'), clock_timestamp()
           FROM generate_series(1, 500) AS series
         RETURNING id
       )
       INSERT INTO messages (contact_id, direction, kind, source, status, body, created_at)
       SELECT id, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'WAITING_WINDOW', 'other contact',
              '2026-10-30T08:00:00Z'
         FROM contacts`,
      [`7${Date.now()}`],
    );
    const targetContact = await createContact(`697${Date.now()}`);
    const target = await createOutbound(targetContact, {
      body: "target contact",
      createdAt: new Date("2026-10-30T09:00:00Z"),
    });

    const claimed = await repository.claimDue(1, [target]);

    expect(claimed.map((row) => row.id)).toEqual([target]);
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
    const extended = await repository.extendLease(queued, claim!.lockedUntil);
    await expect(repository.recordPart(queued, extended!, mid, true)).resolves.toBe(true);
    const rows = await pool.query<{
      id: string;
      source: string;
      status: string;
    }>("SELECT id, source, status FROM messages WHERE external_message_id = $1", [mid]);
    expect(rows.rows).toEqual([{ id: queued, source: "ADMIN", status: "SENT" }]);
  });

  it("deduplicates an echo for a recorded non-last part", async () => {
    const sender = `81${Date.now()}`;
    const contactId = await createContact(sender);
    const queued = await createOutbound(contactId, {
      body: `${"a".repeat(1000)} ${"b".repeat(10)}`,
    });
    const [claim] = await repository.claimDue(1, [queued]);
    const lease = await repository.extendLease(queued, claim!.lockedUntil);
    const mid = `non-last-${randomUUID()}`;
    await repository.recordPart(queued, lease!, mid, false);

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

    const rows = await pool.query<{
      id: string;
      source: string;
      status: string;
    }>(
      `SELECT id, source, status FROM messages
        WHERE external_message_id = $1 OR $1 = ANY(COALESCE(external_part_ids, '{}'))`,
      [mid],
    );
    expect(rows.rows).toEqual([{ id: queued, source: "ADMIN", status: "QUEUED" }]);
  });

  it("delivers and exposes conversation read models", async () => {
    const sender = `90${Date.now()}`;
    const contactId = await createContact(sender);
    const messageId = await createOutbound(contactId, {
      body: "hello from admin",
    });
    const messenger = fakeMessenger({
      sendText: vi.fn(async () => ({ messageId: "sent-mid" })),
    });
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
    const listed = await repository.listConversations({
      page: 1,
      pageSize: 100,
    });
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

  it("exposes outbound attachment URLs and linked request identifiers", async () => {
    const contactId = await createContact(`901${Date.now()}`);
    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, {
      handle: "read.model",
      contactId,
    });
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, reservation_id, event_id, direction, kind, source, status, body,
         attachment_urls, location_revision
       ) VALUES ($1, $2, $3, 'OUTBOUND', 'LOCATION', 'SYSTEM', 'QUEUED', 'ubicación',
                 ARRAY['https://example.com/location.jpg'], 1) RETURNING id`,
      [contactId, reservationId, eventId],
    );
    const detail = await repository.getConversation(contactId);
    expect(detail!.linkedRequests[0]).toMatchObject({
      eventId,
      instagramHandles: ["read.model"],
    });
    expect(detail!.messages.find((message) => message.id === inserted.rows[0]!.id)).toMatchObject({
      attachmentUrls: ["https://example.com/location.jpg"],
    });
    const requestMessages = await repository.getRequestMessages({
      reservationId,
    });
    expect(requestMessages.find((message) => message.id === inserted.rows[0]!.id)).toMatchObject({
      attachmentUrls: ["https://example.com/location.jpg"],
    });
  });

  it("delivers older due rows before an immediate admin target", async () => {
    const contactId = await createContact(`905${Date.now()}`);
    await createOutbound(contactId, {
      body: "older",
      createdAt: new Date("2026-10-30T09:00:00Z"),
    });
    const target = await createOutbound(contactId, {
      body: "target",
      createdAt: new Date("2026-10-30T09:01:00Z"),
    });
    const sendText = vi
      .fn()
      .mockResolvedValueOnce({ messageId: "older-mid" })
      .mockResolvedValueOnce({ messageId: "target-mid" });
    const summary = await deliverMessagesNow(
      {
        repository,
        messenger: fakeMessenger({ sendText }),
        now: () => now.getTime(),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [target],
      { timeBudgetMs: 1000 },
    );
    expect(sendText.mock.calls.map((call) => call[1])).toEqual(["older", "target"]);
    expect(summary.outcomes[target]).toBe("SENT");

    const blockedContact = await createContact(`906${Date.now()}`);
    await createOutbound(blockedContact, {
      body: "window",
      status: "WAITING_WINDOW",
      createdAt: new Date("2026-10-30T09:00:00Z"),
    });
    const blockedTarget = await createOutbound(blockedContact, {
      body: "blocked",
      createdAt: new Date("2026-10-30T09:01:00Z"),
    });
    const blockedSend = vi.fn(async () => ({ messageId: "unexpected" }));
    const blockedSummary = await deliverMessagesNow(
      {
        repository,
        messenger: fakeMessenger({ sendText: blockedSend }),
        now: () => now.getTime(),
        logFailure: vi.fn(),
        logStaleLease: vi.fn(),
      },
      [blockedTarget],
      { timeBudgetMs: 1000 },
    );
    expect(blockedSend).not.toHaveBeenCalled();
    expect(blockedSummary.outcomes[blockedTarget]).toBe("QUEUED");
    await expect(repository.isBlockedByWaitingWindow(blockedTarget)).resolves.toBe(true);
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
          throw new MessengerError("outside", {
            status: 400,
            code: 10,
            subcode: 2534022,
          });
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
    const messenger = fakeMessenger({
      sendText: vi.fn(async () => ({ messageId: "admin-mid" })),
    });
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
      {
        repository,
        consumeRateLimit: async () => ({ allowed: true }),
        deliver,
      },
      contactId,
      "respuesta",
      adminId,
    );
    expect(sent).toMatchObject({ ok: true, status: "SENT" });

    const failed = await createOutbound(contactId, { status: "FAILED" });
    expect(await retryMessage(repository, failed)).toBe("UPDATED");
    expect(await markSentManually(repository, failed, adminId)).toBe("UPDATED");
    const pending = await createOutbound(contactId);
    expect(await discardMessage(repository, pending, adminId)).toBe("UPDATED");

    const eventId = await createEvent();
    const reservationId = await createReservation(eventId, {
      handle: "manual.guest",
    });
    expect(await linkContact(repository, contactId, { reservationId }, adminId)).toBe(true);
    expect(await unlinkContact(repository, contactId, { reservationId }, adminId)).toBe("UPDATED");
    const reservation = await pool.query<{ contact_id: string | null }>(
      "SELECT contact_id FROM reservations WHERE id = $1",
      [reservationId],
    );
    expect(reservation.rows[0]!.contact_id).toBeNull();
  });

  it("manual code linking overrides an existing link and audits the previous contact", async () => {
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Code Admin') RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    const oldContact = await createContact(`96${Date.now()}`);
    const newContact = await createContact(`97${Date.now()}`);
    const reservationId = await createReservation(await createEvent(), {
      handle: "code.manual",
      linkCode: "NPQ238",
      contactId: oldContact,
    });

    await expect(
      linkContactByCode(repository, newContact, "NPQ238", admin.rows[0]!.id),
    ).resolves.toBe(1);
    const linked = await pool.query<{
      contact_id: string;
      contact_linked_by: string;
    }>("SELECT contact_id, contact_linked_by FROM reservations WHERE id = $1", [reservationId]);
    expect(linked.rows[0]).toEqual({
      contact_id: newContact,
      contact_linked_by: "MANUAL",
    });
    const audit = await pool.query<{ metadata: Record<string, string> }>(
      `SELECT metadata FROM audit_logs
        WHERE action = 'MESSAGING_CONTACT_LINKED' AND entity_id = $1
        ORDER BY id DESC LIMIT 1`,
      [reservationId],
    );
    expect(audit.rows[0]!.metadata).toEqual({
      contactId: newContact,
      previousContactId: oldContact,
      method: "MANUAL",
    });
  });

  it("blocks admin mutations during a live lease and audits unlink retargeting", async () => {
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'hash', 'Lease Admin') RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    const adminId = admin.rows[0]!.id;
    const contactId = await createContact(`98${Date.now()}`);
    const reservationId = await createReservation(await createEvent(), {
      handle: "lease.guest",
      contactId,
    });
    const queued = await createOutbound(contactId, { reservationId });
    await repository.claimDue(1, [queued]);

    await expect(retryMessage(repository, queued)).resolves.toBe("LIVE_LEASE");
    await expect(markSentManually(repository, queued, adminId)).resolves.toBe("LIVE_LEASE");
    await expect(discardMessage(repository, queued, adminId)).resolves.toBe("LIVE_LEASE");
    await expect(unlinkContact(repository, contactId, { reservationId }, adminId)).resolves.toBe(
      "LIVE_LEASE",
    );

    await pool.query(
      `UPDATE messages
          SET locked_until = NULL, status = 'FAILED', parts_sent = 1,
              external_part_ids = ARRAY['partial-mid'], attempts = 4,
              claims_without_progress = 3
        WHERE id = $1`,
      [queued],
    );
    await expect(unlinkContact(repository, contactId, { reservationId }, adminId)).resolves.toBe(
      "UPDATED",
    );
    const message = await pool.query<{
      status: string;
      contact_id: string | null;
      parts_sent: number;
      external_part_ids: string[] | null;
      attempts: number;
      claims_without_progress: number;
    }>(
      `SELECT status, contact_id, parts_sent, external_part_ids, attempts,
              claims_without_progress
         FROM messages WHERE id = $1`,
      [queued],
    );
    expect(message.rows[0]).toEqual({
      status: "WAITING_CONTACT",
      contact_id: null,
      parts_sent: 0,
      external_part_ids: null,
      attempts: 0,
      claims_without_progress: 0,
    });
    const audit = await pool.query<{ metadata: Record<string, string> }>(
      `SELECT metadata FROM audit_logs
        WHERE action = 'MESSAGING_CONTACT_UNLINKED' AND entity_id = $1`,
      [reservationId],
    );
    expect(audit.rows[0]!.metadata).toEqual({ contactId });
  });

  it("does not fall back to a message contact when its subject is unlinked", async () => {
    const contactId = await createContact(`99${Date.now()}`);
    const reservationId = await createReservation(await createEvent(), {
      handle: "subject.only",
    });
    const failed = await createOutbound(contactId, {
      reservationId,
      status: "FAILED",
    });

    await expect(repository.retryMessage(failed)).resolves.toBe("NOT_UPDATED");
  });
});
