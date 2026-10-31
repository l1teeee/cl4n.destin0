import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  DeliverableMessage,
  MessageDeliveryRepository,
} from "@/application/messaging/message-repository";
import type {
  InstagramEventRepository,
  InstagramIngestionTransactionResult,
} from "@/application/messaging/instagram-event-ingestion";
import type {
  AdminMessageRepository,
  MessageSubject,
} from "@/application/messaging/admin-message-repository";
import type {
  ConversationDetail,
  ConversationMessage,
  ConversationQueryRepository,
  ConversationSummary,
  LinkedRequestSummary,
  RequestMessageSubject,
} from "@/application/messaging/conversation-queries";
import type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";
import type { MessageKind, MessageStatus } from "@/domain/messaging/message-types";
import { extractLinkCode, isLinkCode } from "@/domain/messaging/link-code";

import { pool as applicationPool } from "../client";

interface DeliverableRecord extends QueryResultRow {
  id: string;
  kind: Exclude<MessageKind, "INBOUND">;
  contact_id: string;
  instagram_scoped_id: string;
  last_inbound_at: Date | null;
  body: string | null;
  attachment_urls: string[] | null;
  attempts: number;
  locked_until: Date;
  reservation_status: string | null;
  reservation_stage: string | null;
  waitlist_status: string | null;
  location_status: string | null;
  message_location_revision: number | null;
  current_location_revision: number | null;
  clue_present: boolean;
  created_at: Date;
}

function toDeliverable(row: DeliverableRecord): DeliverableMessage {
  return {
    id: row.id,
    kind: row.kind,
    contactId: row.contact_id,
    recipientId: row.instagram_scoped_id,
    lastInboundAt: row.last_inbound_at,
    body: row.body,
    attachmentUrls: row.attachment_urls ?? [],
    attempts: row.attempts,
    lockedUntil: row.locked_until,
    relevance: {
      reservationStatus: row.reservation_status,
      reservationStage: row.reservation_stage,
      waitlistStatus: row.waitlist_status,
      locationStatus: row.location_status,
      messageLocationRevision: row.message_location_revision,
      currentLocationRevision: row.current_location_revision,
      cluePresent: row.clue_present,
    },
  };
}

function linkCodeFromEvent(event: InstagramWebhookEvent): string | null {
  if (event.type === "referral")
    return isLinkCode(event.ref.toUpperCase()) ? event.ref.toUpperCase() : null;
  if (event.type !== "inbound_message") return null;
  for (const candidate of [event.quickReplyPayload, event.referralRef]) {
    if (candidate && isLinkCode(candidate.toUpperCase())) return candidate.toUpperCase();
  }
  return event.text ? extractLinkCode(event.text) : null;
}

interface ContactRow extends QueryResultRow {
  id: string;
  instagram_scoped_id: string;
  username: string | null;
}

export class PostgresMessageRepository
  implements
    MessageDeliveryRepository,
    InstagramEventRepository,
    AdminMessageRepository,
    ConversationQueryRepository
{
  constructor(readonly pool: Pool = applicationPool) {}

  async claimDue(limit: number, messageIds?: readonly string[]): Promise<DeliverableMessage[]> {
    const result = await this.pool.query<DeliverableRecord>(
      `WITH candidates AS (
         SELECT m.id
           FROM messages m
          WHERE m.direction = 'OUTBOUND'
            AND m.status = 'QUEUED'
            AND m.next_attempt_at <= clock_timestamp()
            AND (m.locked_until IS NULL OR m.locked_until < clock_timestamp())
            AND ($2::uuid[] IS NULL OR m.id = ANY($2::uuid[]))
            AND NOT EXISTS (
              SELECT 1
                FROM messages older
               WHERE older.contact_id = m.contact_id
                 AND older.direction = 'OUTBOUND'
                 AND older.status IN ('QUEUED', 'WAITING_WINDOW')
                 AND (older.created_at, older.id) < (m.created_at, m.id)
            )
          ORDER BY m.created_at, m.id
          LIMIT $1
            FOR UPDATE SKIP LOCKED
       ), claimed AS (
         UPDATE messages m
            SET locked_until = date_trunc('milliseconds', clock_timestamp()) + interval '2 minutes',
                attempts = attempts + 1
           FROM candidates c
          WHERE m.id = c.id
        RETURNING m.*
       )
       SELECT c.id, c.kind, c.contact_id, contact.instagram_scoped_id,
              contact.last_inbound_at, c.body, c.attachment_urls, c.attempts, c.locked_until,
              r.status AS reservation_status, r.stage AS reservation_stage,
              w.status AS waitlist_status, e.location_status,
              c.location_revision AS message_location_revision,
              e.location_revision AS current_location_revision,
              EXISTS (SELECT 1 FROM event_clues clue WHERE clue.id = c.clue_id) AS clue_present,
              c.created_at
         FROM claimed c
         JOIN messaging_contacts contact ON contact.id = c.contact_id
         LEFT JOIN reservations r ON r.id = c.reservation_id
         LEFT JOIN waitlist_entries w ON w.id = c.waitlist_entry_id
         LEFT JOIN events e ON e.id = c.event_id
        ORDER BY c.created_at, c.id`,
      [limit, messageIds ? [...messageIds] : null],
    );
    return result.rows.map(toDeliverable);
  }

  private async complete(
    id: string,
    lease: Date,
    update: string,
    parameters: unknown[] = [],
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE messages SET ${update}
        WHERE id = $1 AND status = 'QUEUED' AND locked_until = $2`,
      [id, lease, ...parameters],
    );
    return result.rowCount === 1;
  }

  markDiscarded(id: string, lease: Date, errorCode: string): Promise<boolean> {
    return this.complete(id, lease, "status = 'DISCARDED', locked_until = NULL, last_error = $3", [
      errorCode,
    ]);
  }

  markWaitingWindow(id: string, lease: Date, errorCode: string | undefined): Promise<boolean> {
    return this.complete(
      id,
      lease,
      "status = 'WAITING_WINDOW', locked_until = NULL, last_error = $3",
      [errorCode ?? null],
    );
  }

  async markSent(id: string, lease: Date, externalMessageId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query(
        `SELECT 1 FROM messages
          WHERE id = $1 AND status = 'QUEUED' AND locked_until = $2
          FOR UPDATE`,
        [id, lease],
      );
      if (owned.rowCount !== 1) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `DELETE FROM messages
          WHERE external_message_id = $1
            AND direction = 'OUTBOUND'
            AND source = 'INSTAGRAM_APP'
            AND id <> $2`,
        [externalMessageId, id],
      );
      const result = await client.query(
        `UPDATE messages
            SET status = 'SENT', external_message_id = $3,
                sent_at = clock_timestamp(), locked_until = NULL, last_error = NULL
          WHERE id = $1 AND status = 'QUEUED' AND locked_until = $2`,
        [id, lease, externalMessageId],
      );
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  scheduleRetry(
    id: string,
    lease: Date,
    delaySeconds: number,
    errorCode: string,
  ): Promise<boolean> {
    return this.complete(
      id,
      lease,
      "next_attempt_at = clock_timestamp() + make_interval(secs => $3), locked_until = NULL, last_error = $4",
      [delaySeconds, errorCode],
    );
  }

  markFailed(id: string, lease: Date, errorCode: string): Promise<boolean> {
    return this.complete(id, lease, "status = 'FAILED', locked_until = NULL, last_error = $3", [
      errorCode,
    ]);
  }

  async getStatus(id: string): Promise<MessageStatus | null> {
    const result = await this.pool.query<{ status: MessageStatus }>(
      "SELECT status FROM messages WHERE id = $1",
      [id],
    );
    return result.rows[0]?.status ?? null;
  }

  async getDeliveryState(
    id: string,
  ): Promise<{ status: MessageStatus; lastError: string | null } | null> {
    const result = await this.pool.query<{ status: MessageStatus; last_error: string | null }>(
      "SELECT status, last_error FROM messages WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? { status: row.status, lastError: row.last_error } : null;
  }

  private async upsertContact(
    client: PoolClient,
    input: {
      scopedId: string;
      inboundAt?: Date;
      username?: string;
    },
  ): Promise<ContactRow> {
    const result = await client.query<ContactRow>(
      `INSERT INTO messaging_contacts (
         instagram_scoped_id, username, last_inbound_at, updated_at
       ) VALUES ($1, $2, $3, clock_timestamp())
       ON CONFLICT (instagram_scoped_id) DO UPDATE
         SET username = COALESCE(EXCLUDED.username, messaging_contacts.username),
             last_inbound_at = CASE
               WHEN EXCLUDED.last_inbound_at IS NULL THEN messaging_contacts.last_inbound_at
               WHEN messaging_contacts.last_inbound_at IS NULL THEN EXCLUDED.last_inbound_at
               ELSE GREATEST(messaging_contacts.last_inbound_at, EXCLUDED.last_inbound_at)
             END,
             updated_at = clock_timestamp()
       RETURNING id, instagram_scoped_id, username`,
      [input.scopedId, input.username ?? null, input.inboundAt ?? null],
    );
    return result.rows[0]!;
  }

  private async releaseWaitingWindow(client: PoolClient, contactId: string): Promise<boolean> {
    const result = await client.query(
      `UPDATE messages
          SET status = 'QUEUED', next_attempt_at = clock_timestamp(),
              locked_until = NULL, last_error = NULL
        WHERE contact_id = $1 AND direction = 'OUTBOUND' AND status = 'WAITING_WINDOW'`,
      [contactId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async linkByCode(
    client: PoolClient,
    contactId: string,
    linkCode: string,
    method: "CODE" | "MANUAL",
    actorAdminId: string | null = null,
  ): Promise<boolean> {
    let becameQueued = false;
    for (const subject of [
      { table: "reservations", entityType: "RESERVATION", idColumn: "reservation_id" },
      { table: "waitlist_entries", entityType: "WAITLIST_ENTRY", idColumn: "waitlist_entry_id" },
    ] as const) {
      const linked = await client.query<{ id: string }>(
        `UPDATE ${subject.table}
            SET contact_id = $1, updated_at = clock_timestamp()
          WHERE link_code = $2 AND contact_id IS NULL
        RETURNING id`,
        [contactId, linkCode],
      );
      for (const row of linked.rows) {
        const released = await client.query(
          `UPDATE messages
              SET contact_id = $1, status = 'QUEUED', next_attempt_at = clock_timestamp(),
                  locked_until = NULL, last_error = NULL
            WHERE ${subject.idColumn} = $2 AND status = 'WAITING_CONTACT'`,
          [contactId, row.id],
        );
        becameQueued ||= (released.rowCount ?? 0) > 0;
        await client.query(
          `INSERT INTO audit_logs (
             actor_type, actor_admin_id, action, entity_type, entity_id, metadata
           ) VALUES ($1, $2, 'MESSAGING_CONTACT_LINKED', $3, $4, $5::jsonb)`,
          [
            actorAdminId ? "ADMIN" : "SYSTEM",
            actorAdminId,
            subject.entityType,
            row.id,
            JSON.stringify({ contactId, method }),
          ],
        );
      }
    }
    return becameQueued;
  }

  async ingestEvents(
    events: readonly InstagramWebhookEvent[],
    knownUsernames: Readonly<Record<string, string>> = {},
  ): Promise<InstagramIngestionTransactionResult> {
    return this.withTransaction(async (client) => {
      const contacts = new Map<string, ContactRow>();
      const images: InstagramIngestionTransactionResult["images"] = [];
      let becameQueued = false;

      for (const event of events) {
        if (event.type === "inbound_message") {
          const contact = await this.upsertContact(client, {
            scopedId: event.senderId,
            inboundAt: event.timestamp,
            username: knownUsernames[event.senderId],
          });
          contacts.set(contact.id, contact);
          const releasedWindow = await this.releaseWaitingWindow(client, contact.id);
          becameQueued ||= releasedWindow;

          const body =
            event.text?.trim() ||
            (event.attachmentUrls.length === 0 ? "[contenido no compatible]" : null);
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO messages (
               contact_id, direction, kind, source, status, body, attachment_urls,
               external_message_id, created_at
             ) VALUES ($1, 'INBOUND', 'INBOUND', 'GUEST', 'RECEIVED', $2, $3::text[], $4, $5)
             ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
             RETURNING id`,
            [
              contact.id,
              body,
              event.attachmentUrls.length > 0 ? event.attachmentUrls : null,
              event.externalMessageId,
              event.timestamp,
            ],
          );
          const messageId = inserted.rows[0]?.id;
          if (messageId) {
            let searchFrom = 0;
            for (const url of event.imageAttachmentUrls) {
              const position = event.attachmentUrls.indexOf(url, searchFrom);
              if (position >= 0) {
                images.push({ messageId, position, url });
                searchFrom = position + 1;
              }
            }
          }
          const code = linkCodeFromEvent(event);
          if (code) {
            const releasedContact = await this.linkByCode(client, contact.id, code, "CODE");
            becameQueued ||= releasedContact;
          }
          continue;
        }

        if (event.type === "echo") {
          const exists = await client.query(
            "SELECT 1 FROM messages WHERE external_message_id = $1",
            [event.externalMessageId],
          );
          if ((exists.rowCount ?? 0) > 0) continue;
          const contact = await this.upsertContact(client, {
            scopedId: event.recipientId,
            username: knownUsernames[event.recipientId],
          });
          contacts.set(contact.id, contact);
          const body =
            event.text?.trim() ||
            (event.attachmentUrls.length === 0 ? "[contenido no compatible]" : null);
          await client.query(
            `INSERT INTO messages (
               contact_id, direction, kind, source, status, body, attachment_urls,
               external_message_id, sent_at, created_at
             ) VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'INSTAGRAM_APP', 'SENT',
                       $2, $3::text[], $4, $5, $5)
             ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING`,
            [
              contact.id,
              body,
              event.attachmentUrls.length > 0 ? event.attachmentUrls : null,
              event.externalMessageId,
              event.timestamp,
            ],
          );
          continue;
        }

        if (event.type === "deleted") {
          await client.query(
            "DELETE FROM messages WHERE external_message_id = $1 AND direction = 'INBOUND'",
            [event.externalMessageId],
          );
          continue;
        }

        if (event.type === "message_edit") {
          await client.query(
            `UPDATE messages SET body = $2
              WHERE external_message_id = $1 AND direction = 'INBOUND'`,
            [event.externalMessageId, event.text.trim() || "[contenido no compatible]"],
          );
          continue;
        }

        if (event.type === "read") {
          const contact = await client.query<{ id: string }>(
            "SELECT id FROM messaging_contacts WHERE instagram_scoped_id = $1",
            [event.senderId],
          );
          const contactId = contact.rows[0]?.id;
          if (!contactId) continue;
          const seen = await client.query<{ sent_at: Date }>(
            `SELECT sent_at FROM messages
              WHERE contact_id = $1 AND external_message_id = $2 AND sent_at IS NOT NULL`,
            [contactId, event.externalMessageId],
          );
          const through = seen.rows[0]?.sent_at ?? event.timestamp;
          await client.query(
            `UPDATE messages
                SET status = 'READ', read_at = GREATEST(COALESCE(read_at, $2), $2)
              WHERE contact_id = $1 AND direction = 'OUTBOUND'
                AND status IN ('SENT', 'READ') AND sent_at <= $3`,
            [contactId, event.timestamp, through],
          );
          continue;
        }

        if (event.type === "referral" || event.type === "window_signal") {
          const contact = await this.upsertContact(client, {
            scopedId: event.senderId,
            inboundAt: event.timestamp,
            username: knownUsernames[event.senderId],
          });
          contacts.set(contact.id, contact);
          const releasedWindow = await this.releaseWaitingWindow(client, contact.id);
          becameQueued ||= releasedWindow;
          const code = linkCodeFromEvent(event);
          if (code) {
            const releasedContact = await this.linkByCode(client, contact.id, code, "CODE");
            becameQueued ||= releasedContact;
          }
        }
      }

      return {
        contacts: [...contacts.values()].map((contact) => ({
          contactId: contact.id,
          recipientId: contact.instagram_scoped_id,
          username: contact.username,
        })),
        images,
        becameQueued,
      };
    });
  }

  async storeProfile(
    contactId: string,
    username: string | null,
    displayName: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE messaging_contacts
          SET username = $2, display_name = $3, updated_at = clock_timestamp()
        WHERE id = $1`,
      [contactId, username, displayName],
    );
  }

  async linkByUsername(contactId: string, username: string): Promise<boolean> {
    return this.withTransaction(async (client) => {
      let becameQueued = false;
      for (const subject of [
        {
          table: "reservations",
          entityType: "RESERVATION",
          idColumn: "reservation_id",
          status: "CONFIRMED",
        },
        {
          table: "waitlist_entries",
          entityType: "WAITLIST_ENTRY",
          idColumn: "waitlist_entry_id",
          status: "WAITING",
        },
      ] as const) {
        const linked = await client.query<{ id: string }>(
          `UPDATE ${subject.table} subject
              SET contact_id = $1, updated_at = clock_timestamp()
             FROM events e
            WHERE subject.event_id = e.id AND subject.contact_id IS NULL
              AND subject.status = $3 AND e.deleted_at IS NULL
              AND e.starts_at > clock_timestamp()
              AND (subject.instagram_handle = $2 OR subject.guest2_instagram_handle = $2)
          RETURNING subject.id`,
          [contactId, username, subject.status],
        );
        for (const row of linked.rows) {
          const released = await client.query(
            `UPDATE messages
                SET contact_id = $1, status = 'QUEUED', next_attempt_at = clock_timestamp(),
                    locked_until = NULL, last_error = NULL
              WHERE ${subject.idColumn} = $2 AND status = 'WAITING_CONTACT'`,
            [contactId, row.id],
          );
          becameQueued ||= (released.rowCount ?? 0) > 0;
          await client.query(
            `INSERT INTO audit_logs (
               actor_type, action, entity_type, entity_id, metadata
             ) VALUES ('SYSTEM', 'MESSAGING_CONTACT_LINKED', $1, $2, $3::jsonb)`,
            [subject.entityType, row.id, JSON.stringify({ contactId, method: "USERNAME" })],
          );
        }
      }
      return becameQueued;
    });
  }

  async storeAttachment(input: {
    messageId: string;
    position: number;
    contentType: string;
    data: Buffer;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO message_attachments (message_id, position, content_type, byte_size, data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (message_id, position) DO NOTHING`,
      [input.messageId, input.position, input.contentType, input.data.length, input.data],
    );
  }

  async getAttachment(id: string): Promise<{ contentType: string; data: Buffer } | null> {
    const result = await this.pool.query<{ content_type: string; data: Buffer }>(
      "SELECT content_type, data FROM message_attachments WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    return row ? { contentType: row.content_type, data: row.data } : null;
  }

  async createFreeText(contactId: string, text: string, adminId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO messages (
         contact_id, direction, kind, source, status, body, created_by
       )
       SELECT id, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'QUEUED', $2, $3
         FROM messaging_contacts WHERE id = $1
       RETURNING id`,
      [contactId, text, adminId],
    );
    return result.rows[0]?.id ?? null;
  }

  async retryMessage(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE messages
          SET status = 'QUEUED', attempts = 0, next_attempt_at = clock_timestamp(),
              locked_until = NULL, last_error = NULL
        WHERE id = $1 AND direction = 'OUTBOUND'
          AND status IN ('FAILED', 'WAITING_WINDOW', 'WAITING_CONTACT')
          AND contact_id IS NOT NULL`,
      [id],
    );
    return result.rowCount === 1;
  }

  async markSentManually(id: string, adminId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE messages
          SET status = 'SENT_MANUALLY', sent_at = clock_timestamp(),
              handled_by = $2, locked_until = NULL, last_error = NULL
        WHERE id = $1 AND direction = 'OUTBOUND'
          AND status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED', 'FAILED')`,
      [id, adminId],
    );
    return result.rowCount === 1;
  }

  async discardMessage(id: string, adminId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE messages
          SET status = 'DISCARDED', handled_by = $2, locked_until = NULL
        WHERE id = $1 AND direction = 'OUTBOUND'
          AND status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED')`,
      [id, adminId],
    );
    return result.rowCount === 1;
  }

  async linkContact(contactId: string, subject: MessageSubject, adminId: string): Promise<boolean> {
    return this.withTransaction(async (client) => {
      const contact = await client.query("SELECT 1 FROM messaging_contacts WHERE id = $1", [
        contactId,
      ]);
      if ((contact.rowCount ?? 0) === 0) return false;
      const reservation = "reservationId" in subject;
      const table = reservation ? "reservations" : "waitlist_entries";
      const id = reservation ? subject.reservationId : subject.waitlistEntryId;
      const idColumn = reservation ? "reservation_id" : "waitlist_entry_id";
      const entityType = reservation ? "RESERVATION" : "WAITLIST_ENTRY";
      const linked = await client.query<{ id: string }>(
        `UPDATE ${table}
            SET contact_id = $1, updated_at = clock_timestamp()
          WHERE id = $2 AND (contact_id IS NULL OR contact_id = $1)
        RETURNING id`,
        [contactId, id],
      );
      if (!linked.rows[0]) return false;
      await client.query(
        `UPDATE messages
            SET contact_id = $1, status = 'QUEUED', next_attempt_at = clock_timestamp(),
                locked_until = NULL, last_error = NULL
          WHERE ${idColumn} = $2 AND status = 'WAITING_CONTACT'`,
        [contactId, id],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         ) VALUES ('ADMIN', $1, 'MESSAGING_CONTACT_LINKED', $2, $3, $4::jsonb)`,
        [adminId, entityType, id, JSON.stringify({ contactId, method: "MANUAL" })],
      );
      return true;
    });
  }

  async unlinkContact(
    contactId: string,
    subject: MessageSubject,
    _adminId: string,
  ): Promise<boolean> {
    void _adminId;
    return this.withTransaction(async (client) => {
      const reservation = "reservationId" in subject;
      const table = reservation ? "reservations" : "waitlist_entries";
      const id = reservation ? subject.reservationId : subject.waitlistEntryId;
      const idColumn = reservation ? "reservation_id" : "waitlist_entry_id";
      const unlinked = await client.query(
        `UPDATE ${table}
            SET contact_id = NULL, updated_at = clock_timestamp()
          WHERE id = $1 AND contact_id = $2`,
        [id, contactId],
      );
      if (unlinked.rowCount !== 1) return false;
      await client.query(
        `UPDATE messages
            SET contact_id = NULL, status = 'WAITING_CONTACT',
                locked_until = NULL, last_error = NULL
          WHERE ${idColumn} = $1 AND contact_id = $2
            AND status IN ('QUEUED', 'WAITING_WINDOW')`,
        [id, contactId],
      );
      return true;
    });
  }

  async markConversationRead(contactId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE messaging_contacts
          SET admin_read_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1`,
      [contactId],
    );
    return result.rowCount === 1;
  }

  private async linkedRequests(
    contactIds: readonly string[],
  ): Promise<Map<string, LinkedRequestSummary[]>> {
    const grouped = new Map<string, LinkedRequestSummary[]>();
    if (contactIds.length === 0) return grouped;
    const result = await this.pool.query<{
      contact_id: string;
      id: string;
      type: "RESERVATION" | "WAITLIST_ENTRY";
      event_name: string;
      starts_at: Date;
      full_name: string;
      guest2_full_name: string | null;
      status: string;
      stage: string | null;
    }>(
      `SELECT r.contact_id, r.id, 'RESERVATION'::text AS type,
              e.internal_name AS event_name, e.starts_at, r.full_name,
              r.guest2_full_name, r.status::text, r.stage
         FROM reservations r JOIN events e ON e.id = r.event_id
        WHERE r.contact_id = ANY($1::uuid[])
       UNION ALL
       SELECT w.contact_id, w.id, 'WAITLIST_ENTRY'::text AS type,
              e.internal_name, e.starts_at, w.full_name,
              w.guest2_full_name, w.status, NULL::text
         FROM waitlist_entries w JOIN events e ON e.id = w.event_id
        WHERE w.contact_id = ANY($1::uuid[])
       ORDER BY starts_at DESC, id`,
      [[...contactIds]],
    );
    for (const row of result.rows) {
      const requests = grouped.get(row.contact_id) ?? [];
      requests.push({
        id: row.id,
        type: row.type,
        eventName: row.event_name,
        eventStartsAt: row.starts_at,
        guests: [row.full_name, row.guest2_full_name].filter((name): name is string =>
          Boolean(name),
        ),
        status: row.status,
        stage: row.stage,
      });
      grouped.set(row.contact_id, requests);
    }
    return grouped;
  }

  async listConversations(input: {
    search?: string;
    unlinkedOnly?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ items: ConversationSummary[]; total: number }> {
    const search = input.search?.trim() || null;
    const unlinkedOnly = input.unlinkedOnly ?? false;
    const offset = Math.max(0, input.page - 1) * input.pageSize;
    const where = `($1::text IS NULL OR contact.username ILIKE '%' || $1 || '%'
                    OR contact.display_name ILIKE '%' || $1 || '%')
       AND (NOT $2::boolean OR (
         NOT EXISTS (SELECT 1 FROM reservations r WHERE r.contact_id = contact.id)
         AND NOT EXISTS (SELECT 1 FROM waitlist_entries w WHERE w.contact_id = contact.id)
       ))`;
    const [rows, count] = await Promise.all([
      this.pool.query<{
        id: string;
        username: string | null;
        display_name: string | null;
        preview: string;
        last_activity_at: Date;
        unread_count: number;
      }>(
        `SELECT contact.id, contact.username, contact.display_name,
                LEFT(COALESCE(last_message.body, '[imagen]'), 80) AS preview,
                COALESCE(last_message.created_at, contact.updated_at) AS last_activity_at,
                (SELECT count(*)::int FROM messages unread
                  WHERE unread.contact_id = contact.id AND unread.direction = 'INBOUND'
                    AND unread.created_at > COALESCE(contact.admin_read_at, '-infinity')) AS unread_count
           FROM messaging_contacts contact
           LEFT JOIN LATERAL (
             SELECT body, created_at FROM messages
              WHERE contact_id = contact.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) last_message ON true
          WHERE ${where}
          ORDER BY last_activity_at DESC, contact.id
          LIMIT $3 OFFSET $4`,
        [search, unlinkedOnly, input.pageSize, offset],
      ),
      this.pool.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM messaging_contacts contact WHERE ${where}`,
        [search, unlinkedOnly],
      ),
    ]);
    const linked = await this.linkedRequests(rows.rows.map((row) => row.id));
    return {
      items: rows.rows.map((row) => ({
        contactId: row.id,
        username: row.username,
        displayName: row.display_name,
        lastMessagePreview: row.preview,
        lastActivityAt: row.last_activity_at,
        unreadCount: row.unread_count,
        linkedRequests: linked.get(row.id) ?? [],
      })),
      total: count.rows[0]?.total ?? 0,
    };
  }

  private async messagesFor(where: string, value: string): Promise<ConversationMessage[]> {
    const result = await this.pool.query<{
      id: string;
      direction: "OUTBOUND" | "INBOUND";
      kind: MessageKind;
      source: import("@/domain/messaging/message-types").MessageSource;
      status: MessageStatus;
      body: string | null;
      last_error: string | null;
      sent_at: Date | null;
      read_at: Date | null;
      created_at: Date;
      attachment_ids: string[];
    }>(
      `SELECT m.id, m.direction, m.kind, m.source, m.status, m.body, m.last_error,
              m.sent_at, m.read_at, m.created_at,
              COALESCE(array_agg(a.id::text ORDER BY a.position)
                FILTER (WHERE a.id IS NOT NULL), '{}') AS attachment_ids
         FROM messages m
         LEFT JOIN message_attachments a ON a.message_id = m.id
        WHERE ${where}
        GROUP BY m.id
        ORDER BY m.created_at, m.id`,
      [value],
    );
    return result.rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      kind: row.kind,
      source: row.source,
      status: row.status,
      body: row.body,
      attachmentIds: row.attachment_ids,
      lastError: row.last_error,
      sentAt: row.sent_at,
      readAt: row.read_at,
      createdAt: row.created_at,
    }));
  }

  async getConversation(contactId: string): Promise<ConversationDetail | null> {
    const contact = await this.pool.query<{
      id: string;
      username: string | null;
      display_name: string | null;
      last_inbound_at: Date | null;
      admin_read_at: Date | null;
    }>(
      `SELECT id, username, display_name, last_inbound_at, admin_read_at
         FROM messaging_contacts WHERE id = $1`,
      [contactId],
    );
    const row = contact.rows[0];
    if (!row) return null;
    const [linked, messages] = await Promise.all([
      this.linkedRequests([contactId]),
      this.messagesFor("m.contact_id = $1", contactId),
    ]);
    return {
      contact: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        lastInboundAt: row.last_inbound_at,
        adminReadAt: row.admin_read_at,
      },
      linkedRequests: linked.get(contactId) ?? [],
      messages,
    };
  }

  async countUnreadConversations(): Promise<number> {
    const result = await this.pool.query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM messaging_contacts contact
        WHERE EXISTS (
          SELECT 1 FROM messages m
           WHERE m.contact_id = contact.id AND m.direction = 'INBOUND'
             AND m.created_at > COALESCE(contact.admin_read_at, '-infinity')
        )`,
    );
    return result.rows[0]?.total ?? 0;
  }

  getRequestMessages(subject: RequestMessageSubject): Promise<ConversationMessage[]> {
    return "reservationId" in subject
      ? this.messagesFor("m.reservation_id = $1", subject.reservationId)
      : this.messagesFor("m.waitlist_entry_id = $1", subject.waitlistEntryId);
  }

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export const postgresMessageRepository = new PostgresMessageRepository();
