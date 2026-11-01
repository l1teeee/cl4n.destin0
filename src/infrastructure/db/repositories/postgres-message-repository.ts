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
  AdminMessageMutationResult,
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
import { env } from "@/infrastructure/config/env";
import { log } from "@/infrastructure/observability/logger";

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
  parts_sent: number;
  external_part_ids: string[] | null;
  locked_until: Date;
  reservation_status: string | null;
  reservation_stage: string | null;
  waitlist_status: string | null;
  location_status: string | null;
  message_location_revision: number | null;
  current_location_revision: number | null;
  clue_present: boolean;
  event_status: string | null;
  event_deleted_at: Date | null;
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
    partsSent: row.parts_sent,
    externalPartIds: row.external_part_ids ?? [],
    lockedUntil: row.locked_until,
    relevance: {
      reservationStatus: row.reservation_status,
      reservationStage: row.reservation_stage,
      waitlistStatus: row.waitlist_status,
      locationStatus: row.location_status,
      messageLocationRevision: row.message_location_revision,
      currentLocationRevision: row.current_location_revision,
      cluePresent: row.clue_present,
      eventStatus: row.event_status,
      eventDeleted: row.event_deleted_at !== null,
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

function contactScopedId(event: InstagramWebhookEvent): string | null {
  if (
    event.type === "inbound_message" ||
    event.type === "deleted" ||
    event.type === "referral" ||
    event.type === "window_signal"
  ) {
    return event.senderId;
  }
  return event.type === "echo" ? event.recipientId : null;
}

interface ContactRow extends QueryResultRow {
  id: string;
  instagram_scoped_id: string;
  username: string | null;
}

const LINK_SUBJECTS = [
  {
    table: "waitlist_entries",
    entityType: "WAITLIST_ENTRY",
    idColumn: "waitlist_entry_id",
  },
  {
    table: "reservations",
    entityType: "RESERVATION",
    idColumn: "reservation_id",
  },
] as const;

export class PostgresMessageRepository
  implements
    MessageDeliveryRepository,
    InstagramEventRepository,
    AdminMessageRepository,
    ConversationQueryRepository
{
  constructor(
    readonly pool: Pool = applicationPool,
    private readonly accountId: string | null = null,
  ) {}

  async repairWaitingContacts(): Promise<number> {
    const reservationResult = await this.pool.query(
      `UPDATE messages m
          SET parts_sent = CASE
                WHEN m.contact_id IS NOT NULL AND m.contact_id IS DISTINCT FROM r.contact_id
                  THEN 0 ELSE m.parts_sent END,
              external_part_ids = CASE
                WHEN m.contact_id IS NOT NULL AND m.contact_id IS DISTINCT FROM r.contact_id
                  THEN NULL ELSE m.external_part_ids END,
              attempts = CASE
                WHEN m.contact_id IS NOT NULL AND m.contact_id IS DISTINCT FROM r.contact_id
                  THEN 0 ELSE m.attempts END,
              contact_id = r.contact_id, status = 'QUEUED',
              next_attempt_at = clock_timestamp(), locked_until = NULL, last_error = NULL,
              claims_without_progress = 0
         FROM reservations r
        WHERE m.status = 'WAITING_CONTACT'
          AND m.reservation_id = r.id
          AND r.contact_id IS NOT NULL`,
    );
    const waitlistResult = await this.pool.query(
      `UPDATE messages m
          SET parts_sent = CASE
                WHEN m.contact_id IS NOT NULL AND m.contact_id IS DISTINCT FROM w.contact_id
                  THEN 0 ELSE m.parts_sent END,
              external_part_ids = CASE
                WHEN m.contact_id IS NOT NULL AND m.contact_id IS DISTINCT FROM w.contact_id
                  THEN NULL ELSE m.external_part_ids END,
              attempts = CASE
                WHEN m.contact_id IS NOT NULL AND m.contact_id IS DISTINCT FROM w.contact_id
                  THEN 0 ELSE m.attempts END,
              contact_id = w.contact_id, status = 'QUEUED',
              next_attempt_at = clock_timestamp(), locked_until = NULL, last_error = NULL,
              claims_without_progress = 0
         FROM waitlist_entries w
        WHERE m.status = 'WAITING_CONTACT'
          AND m.waitlist_entry_id = w.id
          AND w.contact_id IS NOT NULL`,
    );
    return (reservationResult.rowCount ?? 0) + (waitlistResult.rowCount ?? 0);
  }

  async claimDue(limit: number, messageIds?: readonly string[]): Promise<DeliverableMessage[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `WITH stalled AS (
           SELECT id
             FROM messages
            WHERE direction = 'OUTBOUND'
              AND status = 'QUEUED'
              AND next_attempt_at <= clock_timestamp()
              AND (locked_until IS NULL OR locked_until < clock_timestamp())
              AND claims_without_progress >= 5
            ORDER BY created_at, id
              FOR UPDATE SKIP LOCKED
         )
         UPDATE messages m
            SET status = 'FAILED', locked_until = NULL, last_error = 'NO_PROGRESS',
                claims_without_progress = 0
           FROM stalled
          WHERE m.id = stalled.id`,
      );
      const result = await client.query<DeliverableRecord>(
        `WITH candidates AS (
         SELECT m.id, recipient.contact_id AS resolved_contact_id
           FROM messages m
           LEFT JOIN reservations r ON r.id = m.reservation_id
           LEFT JOIN waitlist_entries w ON w.id = m.waitlist_entry_id
           CROSS JOIN LATERAL (
             VALUES (CASE
               WHEN m.parts_sent <> 0 THEN m.contact_id
               WHEN m.reservation_id IS NOT NULL THEN r.contact_id
               WHEN m.waitlist_entry_id IS NOT NULL THEN w.contact_id
               ELSE m.contact_id
             END)
           ) AS recipient(contact_id)
          WHERE m.direction = 'OUTBOUND'
            AND m.status = 'QUEUED'
            AND m.next_attempt_at <= clock_timestamp()
            AND (m.locked_until IS NULL OR m.locked_until < clock_timestamp())
            AND m.claims_without_progress < 5
            AND recipient.contact_id IS NOT NULL
            AND ($2::uuid[] IS NULL OR EXISTS (
              SELECT 1
                FROM messages target
                LEFT JOIN reservations target_r ON target_r.id = target.reservation_id
                LEFT JOIN waitlist_entries target_w ON target_w.id = target.waitlist_entry_id
                CROSS JOIN LATERAL (
                  VALUES (CASE
                    WHEN target.parts_sent <> 0 THEN target.contact_id
                    WHEN target.reservation_id IS NOT NULL THEN target_r.contact_id
                    WHEN target.waitlist_entry_id IS NOT NULL THEN target_w.contact_id
                    ELSE target.contact_id
                  END)
                ) AS target_recipient(contact_id)
               WHERE target.id = ANY($2::uuid[])
                 AND target_recipient.contact_id = recipient.contact_id
                 AND (m.created_at, m.id) <= (target.created_at, target.id)
            ))
            AND NOT EXISTS (
              SELECT 1
                FROM messages older
               WHERE older.contact_id = recipient.contact_id
                 AND older.direction = 'OUTBOUND'
                 AND older.status IN ('QUEUED', 'WAITING_WINDOW')
                 AND (older.created_at, older.id) < (m.created_at, m.id)
            )
            AND NOT EXISTS (
              SELECT 1
                FROM messages leased_older
                LEFT JOIN reservations leased_r ON leased_r.id = leased_older.reservation_id
                LEFT JOIN waitlist_entries leased_w
                  ON leased_w.id = leased_older.waitlist_entry_id
               WHERE leased_older.contact_id IS DISTINCT FROM recipient.contact_id
                 AND CASE
                   WHEN leased_older.reservation_id IS NOT NULL THEN leased_r.contact_id
                   WHEN leased_older.waitlist_entry_id IS NOT NULL THEN leased_w.contact_id
                   ELSE leased_older.contact_id
                 END = recipient.contact_id
                 AND leased_older.direction = 'OUTBOUND'
                 AND leased_older.status = 'QUEUED'
                 AND leased_older.parts_sent = 0
                 AND leased_older.locked_until >= clock_timestamp()
                 AND (leased_older.created_at, leased_older.id) < (m.created_at, m.id)
            )
          ORDER BY m.created_at, m.id
          LIMIT $1
            FOR UPDATE OF m SKIP LOCKED
       ), claimed AS (
         UPDATE messages m
            SET contact_id = c.resolved_contact_id,
                external_part_ids = CASE
                  WHEN m.contact_id IS NOT NULL
                    AND m.contact_id IS DISTINCT FROM c.resolved_contact_id
                    THEN NULL ELSE m.external_part_ids END,
                attempts = CASE
                  WHEN m.contact_id IS NOT NULL
                    AND m.contact_id IS DISTINCT FROM c.resolved_contact_id
                    THEN 0 ELSE m.attempts END,
                claims_without_progress = CASE
                  WHEN m.contact_id IS NOT NULL
                    AND m.contact_id IS DISTINCT FROM c.resolved_contact_id
                    THEN 1 ELSE m.claims_without_progress + 1 END,
                locked_until = date_trunc('milliseconds', clock_timestamp()) + interval '2 minutes',
                last_error = NULL
           FROM candidates c
          WHERE m.id = c.id
        RETURNING m.*
       )
       SELECT c.id, c.kind, c.contact_id, contact.instagram_scoped_id,
              contact.last_inbound_at, c.body, c.attachment_urls, c.attempts,
              c.parts_sent, c.external_part_ids, c.locked_until,
              r.status AS reservation_status, r.stage AS reservation_stage,
              w.status AS waitlist_status, e.location_status,
              c.location_revision AS message_location_revision,
              e.location_revision AS current_location_revision,
              EXISTS (SELECT 1 FROM event_clues clue WHERE clue.id = c.clue_id) AS clue_present,
              e.status AS event_status, e.deleted_at AS event_deleted_at,
              c.created_at
         FROM claimed c
         JOIN messaging_contacts contact ON contact.id = c.contact_id
         LEFT JOIN reservations r ON r.id = c.reservation_id
         LEFT JOIN waitlist_entries w ON w.id = c.waitlist_entry_id
         LEFT JOIN events e ON e.id = c.event_id
        ORDER BY c.created_at, c.id`,
        [limit, messageIds ? [...messageIds] : null],
      );
      await client.query("COMMIT");
      return result.rows.map(toDeliverable);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async extendLease(id: string, lease: Date): Promise<Date | null> {
    const result = await this.pool.query<{ locked_until: Date }>(
      `UPDATE messages
          SET locked_until = date_trunc('milliseconds', clock_timestamp()) + interval '2 minutes'
        WHERE id = $1 AND status = 'QUEUED' AND locked_until = $2
      RETURNING locked_until`,
      [id, lease],
    );
    return result.rows[0]?.locked_until ?? null;
  }

  releaseClaim(id: string, lease: Date): Promise<boolean> {
    return this.complete(
      id,
      lease,
      "locked_until = NULL, claims_without_progress = GREATEST(claims_without_progress - 1, 0)",
    );
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
    return this.complete(
      id,
      lease,
      "status = 'DISCARDED', locked_until = NULL, last_error = $3, claims_without_progress = 0",
      [errorCode],
    );
  }

  markWaitingWindow(id: string, lease: Date, errorCode: string | undefined): Promise<boolean> {
    return this.complete(
      id,
      lease,
      errorCode
        ? "status = 'WAITING_WINDOW', attempts = attempts + 1, locked_until = NULL, last_error = $3, claims_without_progress = 0"
        : "status = 'WAITING_WINDOW', locked_until = NULL, last_error = $3, claims_without_progress = 0",
      [errorCode ?? null],
    );
  }

  async recordPart(
    id: string,
    lease: Date,
    externalMessageId: string,
    lastPart: boolean,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        externalMessageId,
      ]);
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
          WHERE direction = 'OUTBOUND'
            AND source = 'INSTAGRAM_APP'
            AND id <> $2
            AND (external_message_id = $1 OR $1 = ANY(COALESCE(external_part_ids, '{}')))`,
        [externalMessageId, id],
      );
      const result = await client.query(
        `UPDATE messages
            SET parts_sent = parts_sent + 1,
                external_part_ids = COALESCE(external_part_ids, '{}') || $3::text,
                status = CASE WHEN $4 THEN 'SENT' ELSE status END,
                external_message_id = CASE WHEN $4 THEN $3 ELSE external_message_id END,
                sent_at = CASE WHEN $4 THEN clock_timestamp() ELSE sent_at END,
                locked_until = CASE WHEN $4 THEN NULL ELSE locked_until END,
                last_error = NULL,
                claims_without_progress = 0
          WHERE id = $1 AND status = 'QUEUED' AND locked_until = $2`,
        [id, lease, externalMessageId, lastPart],
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
      "attempts = attempts + 1, next_attempt_at = clock_timestamp() + make_interval(secs => $3), locked_until = NULL, last_error = $4, claims_without_progress = 0",
      [delaySeconds, errorCode],
    );
  }

  markFailed(id: string, lease: Date, errorCode: string): Promise<boolean> {
    return this.complete(
      id,
      lease,
      "status = 'FAILED', attempts = attempts + 1, locked_until = NULL, last_error = $3, claims_without_progress = 0",
      [errorCode],
    );
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
    const result = await this.pool.query<{
      status: MessageStatus;
      last_error: string | null;
    }>("SELECT status, last_error FROM messages WHERE id = $1", [id]);
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
              locked_until = NULL, last_error = NULL, claims_without_progress = 0
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
  ): Promise<{ becameQueued: boolean; linked: number }> {
    let becameQueued = false;
    let linkedCount = 0;
    for (const subject of LINK_SUBJECTS) {
      const candidates = await client.query<{
        id: string;
        contact_id: string | null;
        contact_linked_by: string | null;
      }>(
        `SELECT id, contact_id, contact_linked_by
           FROM ${subject.table}
          WHERE link_code = $1
            AND ($2::text = 'MANUAL' OR contact_id IS NULL OR contact_linked_by = 'USERNAME')
            AND (contact_id IS DISTINCT FROM $3 OR contact_linked_by IS DISTINCT FROM $2)
          FOR NO KEY UPDATE`,
        [linkCode, method, contactId],
      );
      for (const row of candidates.rows) {
        await client.query(
          `UPDATE ${subject.table}
              SET contact_id = $1, contact_linked_by = $2, updated_at = clock_timestamp()
            WHERE id = $3`,
          [contactId, method, row.id],
        );
        const released = await this.retargetSubjectMessages(
          client,
          subject.idColumn,
          row.id,
          contactId,
        );
        becameQueued ||= released;
        linkedCount += 1;
        await this.auditContactLinked(client, {
          actorAdminId,
          entityType: subject.entityType,
          entityId: row.id,
          contactId,
          previousContactId: row.contact_id,
          method,
        });
      }
    }
    return { becameQueued, linked: linkedCount };
  }

  private async retargetSubjectMessages(
    client: PoolClient,
    idColumn: "reservation_id" | "waitlist_entry_id",
    subjectId: string,
    contactId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE messages
          SET parts_sent = CASE
                WHEN contact_id IS NOT NULL AND contact_id IS DISTINCT FROM $1
                  THEN 0 ELSE parts_sent END,
              external_part_ids = CASE
                WHEN contact_id IS NOT NULL AND contact_id IS DISTINCT FROM $1
                  THEN NULL ELSE external_part_ids END,
              attempts = CASE
                WHEN contact_id IS NOT NULL AND contact_id IS DISTINCT FROM $1
                  THEN 0 ELSE attempts END,
              claims_without_progress = CASE
                WHEN contact_id IS NOT NULL AND contact_id IS DISTINCT FROM $1
                  THEN 0 ELSE claims_without_progress END,
              contact_id = $1,
              status = CASE WHEN status = 'FAILED' THEN 'FAILED' ELSE 'QUEUED' END,
              next_attempt_at = CASE
                WHEN status = 'FAILED' THEN next_attempt_at ELSE clock_timestamp()
              END,
              locked_until = NULL,
              last_error = CASE WHEN status = 'FAILED' THEN last_error ELSE NULL END
        WHERE ${idColumn} = $2
          AND status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED', 'FAILED')
          AND NOT (
            status = 'QUEUED'
            AND locked_until IS NOT NULL
            AND locked_until > clock_timestamp()
          )`,
      [contactId, subjectId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async auditContactLinked(
    client: PoolClient,
    input: {
      actorAdminId: string | null;
      entityType: "RESERVATION" | "WAITLIST_ENTRY";
      entityId: string;
      contactId: string;
      previousContactId: string | null;
      method: "CODE" | "USERNAME" | "MANUAL";
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs (
         actor_type, actor_admin_id, action, entity_type, entity_id, metadata
       ) VALUES ($1, $2, 'MESSAGING_CONTACT_LINKED', $3, $4, $5::jsonb)`,
      [
        input.actorAdminId ? "ADMIN" : "SYSTEM",
        input.actorAdminId,
        input.entityType,
        input.entityId,
        JSON.stringify({
          contactId: input.contactId,
          previousContactId: input.previousContactId,
          method: input.method,
        }),
      ],
    );
  }

  async ingestEvents(
    events: readonly InstagramWebhookEvent[],
    knownUsernames: Readonly<Record<string, string>> = {},
  ): Promise<InstagramIngestionTransactionResult> {
    return this.withTransaction(async (client) => {
      const contactsByScopedId = new Map<string, ContactRow>();
      const images: InstagramIngestionTransactionResult["images"] = [];
      const state = { becameQueued: false };
      const contactInputs = new Map<string, { inboundAt?: Date; username?: string }>();
      for (const event of events) {
        const scopedId = contactScopedId(event);
        if (!scopedId || scopedId === this.accountId) continue;
        let inboundAt: Date | undefined;
        if (
          event.type === "inbound_message" ||
          event.type === "referral" ||
          event.type === "window_signal"
        ) {
          inboundAt = event.timestamp;
        }
        const current = contactInputs.get(scopedId);
        contactInputs.set(scopedId, {
          inboundAt:
            !current?.inboundAt || (inboundAt && inboundAt > current.inboundAt)
              ? inboundAt
              : current.inboundAt,
          username: knownUsernames[scopedId] ?? current?.username,
        });
      }
      for (const scopedId of [...contactInputs.keys()].sort()) {
        const contact = await this.upsertContact(client, {
          scopedId,
          ...contactInputs.get(scopedId),
        });
        contactsByScopedId.set(scopedId, contact);
      }

      for (const [index, event] of events.entries()) {
        if (this.accountId !== null && contactScopedId(event) === this.accountId) continue;
        await client.query("SAVEPOINT instagram_event");
        try {
          await this.ingestEvent(client, event, contactsByScopedId, images, state);
          await client.query("RELEASE SAVEPOINT instagram_event");
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error && typeof error.code === "string"
              ? error.code
              : null;
          if (!code || (code.slice(0, 2) !== "22" && code.slice(0, 2) !== "23")) throw error;
          await client.query("ROLLBACK TO SAVEPOINT instagram_event");
          await client.query("RELEASE SAVEPOINT instagram_event");
          log("warn", "instagram_webhook_item_skipped", {
            index,
            type: event.type,
            code,
          });
        }
      }

      return {
        contacts: [...contactsByScopedId.values()].map((contact) => ({
          contactId: contact.id,
          recipientId: contact.instagram_scoped_id,
          username: contact.username,
        })),
        images,
        becameQueued: state.becameQueued,
      };
    });
  }

  private async ingestEvent(
    client: PoolClient,
    event: InstagramWebhookEvent,
    contacts: ReadonlyMap<string, ContactRow>,
    images: InstagramIngestionTransactionResult["images"],
    state: { becameQueued: boolean },
  ): Promise<void> {
    if (event.type === "inbound_message") {
      const contact = contacts.get(event.senderId)!;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        event.externalMessageId,
      ]);
      const releasedWindow = await this.releaseWaitingWindow(client, contact.id);
      state.becameQueued = state.becameQueued || releasedWindow;
      const body =
        (event.text ? [...event.text.trim()].slice(0, 2000).join("") : null) ||
        (event.attachmentUrls.length === 0 ? "[contenido no compatible]" : null);
      const imagePositions = new Set<number>();
      let imageSearchFrom = 0;
      for (const url of event.imageAttachmentUrls) {
        const position = event.attachmentUrls.indexOf(url, imageSearchFrom);
        if (position >= 0) {
          imagePositions.add(position);
          imageSearchFrom = position + 1;
        }
      }
      const permanentPositions = event.attachmentUrls
        .map((_url, position) => position)
        .filter((position) => !imagePositions.has(position));
      const attachmentError =
        permanentPositions.length > 0
          ? `ATTACHMENT_PERMANENT:,${permanentPositions.join(",")},`
          : null;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO messages (
           contact_id, direction, kind, source, status, body, attachment_urls,
           external_message_id, last_error, received_at, created_at
         ) VALUES ($1, 'INBOUND', 'INBOUND', 'GUEST', 'RECEIVED', $2, $3::text[], $4, $5,
                   clock_timestamp(), $6)
         ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          contact.id,
          body,
          event.attachmentUrls.length > 0 ? event.attachmentUrls : null,
          event.externalMessageId,
          attachmentError,
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
        const linked = await this.linkByCode(client, contact.id, code, "CODE");
        state.becameQueued ||= linked.becameQueued;
      }
      return;
    }

    if (event.type === "echo") {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        event.externalMessageId,
      ]);
      const exists = await client.query(
        `SELECT 1 FROM messages
          WHERE external_message_id = $1 OR $1 = ANY(COALESCE(external_part_ids, '{}'))`,
        [event.externalMessageId],
      );
      if ((exists.rowCount ?? 0) > 0) return;
      const contact = contacts.get(event.recipientId)!;
      const body =
        event.text?.trim() ||
        (event.attachmentUrls.length === 0 ? "[contenido no compatible]" : null);
      await client.query(
        `INSERT INTO messages (
           contact_id, direction, kind, source, status, body, attachment_urls,
           external_message_id, external_part_ids, parts_sent, sent_at, created_at
         ) VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'INSTAGRAM_APP', 'SENT',
                   $2, $3::text[], $4, ARRAY[$4]::text[], 1, $5, $5)
         ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING`,
        [
          contact.id,
          body,
          event.attachmentUrls.length > 0 ? event.attachmentUrls : null,
          event.externalMessageId,
          event.timestamp,
        ],
      );
      return;
    }

    if (event.type === "deleted") {
      const contact = contacts.get(event.senderId)!;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        event.externalMessageId,
      ]);
      const updated = await client.query<{ id: string }>(
        `UPDATE messages
            SET body = '[mensaje eliminado]', attachment_urls = NULL
          WHERE external_message_id = $1 AND direction = 'INBOUND'
        RETURNING id`,
        [event.externalMessageId],
      );
      let messageId = updated.rows[0]?.id;
      if (!messageId) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO messages (
             contact_id, direction, kind, source, status, body, external_message_id,
             received_at, created_at
           ) VALUES ($1, 'INBOUND', 'INBOUND', 'GUEST', 'RECEIVED',
                     '[mensaje eliminado]', $2, clock_timestamp(), $3)
           ON CONFLICT (external_message_id) WHERE external_message_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [contact.id, event.externalMessageId, event.timestamp],
        );
        messageId = inserted.rows[0]?.id;
      }
      if (messageId) {
        await client.query("DELETE FROM message_attachments WHERE message_id = $1", [messageId]);
      }
      return;
    }

    if (event.type === "message_edit") {
      await client.query(
        `UPDATE messages SET body = $2
          WHERE external_message_id = $1 AND direction = 'INBOUND'
            AND body <> '[mensaje eliminado]'`,
        [event.externalMessageId, event.text.trim().slice(0, 2000) || "[contenido no compatible]"],
      );
      return;
    }

    if (event.type === "read") {
      const contact = await client.query<{ id: string }>(
        "SELECT id FROM messaging_contacts WHERE instagram_scoped_id = $1",
        [event.senderId],
      );
      const contactId = contact.rows[0]?.id;
      if (!contactId) return;
      const seen = await client.query<{ sent_at: Date }>(
        `SELECT sent_at FROM messages
          WHERE contact_id = $1 AND sent_at IS NOT NULL
            AND (external_message_id = $2 OR $2 = ANY(COALESCE(external_part_ids, '{}')))`,
        [contactId, event.externalMessageId],
      );
      const through = seen.rows[0]?.sent_at ?? event.timestamp;
      await client.query(
        `UPDATE messages
            SET status = 'READ', read_at = COALESCE(read_at, $2)
          WHERE contact_id = $1 AND direction = 'OUTBOUND'
            AND status IN ('SENT', 'READ') AND sent_at <= $3`,
        [contactId, event.timestamp, through],
      );
      return;
    }

    if (event.type === "referral" || event.type === "window_signal") {
      const contact = contacts.get(event.senderId)!;
      const releasedWindow = await this.releaseWaitingWindow(client, contact.id);
      state.becameQueued = state.becameQueued || releasedWindow;
      const code = linkCodeFromEvent(event);
      if (code) {
        const linked = await this.linkByCode(client, contact.id, code, "CODE");
        state.becameQueued ||= linked.becameQueued;
      }
    }
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
      const requests = await client.query<{ request_key: string }>(
        `SELECT DISTINCT request_key
           FROM (
             SELECT COALESCE(w.link_code, w.id::text) AS request_key
               FROM waitlist_entries w
               JOIN events e ON e.id = w.event_id
              WHERE w.status = 'WAITING' AND w.contact_id IS NULL
                AND w.instagram_handle = $1
                AND e.deleted_at IS NULL
                AND e.status NOT IN ('CANCELLED', 'COMPLETED')
                AND e.starts_at > clock_timestamp()
             UNION
             SELECT COALESCE(r.link_code, r.id::text)
               FROM reservations r
               JOIN events e ON e.id = r.event_id
              WHERE r.status = 'CONFIRMED' AND r.contact_id IS NULL
                AND r.instagram_handle = $1
                AND e.deleted_at IS NULL
                AND e.status NOT IN ('CANCELLED', 'COMPLETED')
                AND e.starts_at > clock_timestamp()
           ) candidates
          LIMIT 2`,
        [username],
      );
      if (requests.rows.length !== 1) return false;

      let becameQueued = false;
      const requestKey = requests.rows[0]!.request_key;
      for (const subject of LINK_SUBJECTS) {
        const status = subject.table === "waitlist_entries" ? "WAITING" : "CONFIRMED";
        const linked = await client.query<{ id: string }>(
          `UPDATE ${subject.table} subject
              SET contact_id = $1, contact_linked_by = 'USERNAME',
                  updated_at = clock_timestamp()
             FROM events e
            WHERE subject.event_id = e.id AND subject.contact_id IS NULL
              AND subject.status = $2 AND subject.instagram_handle = $3
              AND COALESCE(subject.link_code, subject.id::text) = $4
              AND e.deleted_at IS NULL
              AND e.status NOT IN ('CANCELLED', 'COMPLETED')
              AND e.starts_at > clock_timestamp()
          RETURNING subject.id`,
          [contactId, status, username, requestKey],
        );
        for (const row of linked.rows) {
          const released = await this.retargetSubjectMessages(
            client,
            subject.idColumn,
            row.id,
            contactId,
          );
          becameQueued ||= released;
          await this.auditContactLinked(client, {
            actorAdminId: null,
            entityType: subject.entityType,
            entityId: row.id,
            contactId,
            previousContactId: null,
            method: "USERNAME",
          });
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
    await this.withTransaction(async (client) => {
      const message = await client.query(
        `SELECT 1 FROM messages
          WHERE id = $1 AND attachment_urls IS NOT NULL
          FOR SHARE`,
        [input.messageId],
      );
      if (message.rowCount !== 1) return;
      await client.query(
        `INSERT INTO message_attachments (message_id, position, content_type, byte_size, data)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (message_id, position) DO NOTHING`,
        [input.messageId, input.position, input.contentType, input.data.length, input.data],
      );
    });
  }

  async listMissingInboundImages(
    limit: number,
  ): Promise<InstagramIngestionTransactionResult["images"]> {
    const result = await this.pool.query<{
      message_id: string;
      position: number;
      url: string;
    }>(
      `SELECT m.id AS message_id, (url.ordinality - 1)::integer AS position, url.value AS url
         FROM messages m
         CROSS JOIN LATERAL unnest(m.attachment_urls) WITH ORDINALITY AS url(value, ordinality)
         LEFT JOIN message_attachments attachment
           ON attachment.message_id = m.id AND attachment.position = url.ordinality - 1
        WHERE m.direction = 'INBOUND'
          AND m.received_at >= clock_timestamp() - interval '3 days'
          AND attachment.id IS NULL
          AND position(',' || (url.ordinality - 1)::text || ',' IN COALESCE(m.last_error, '')) = 0
        ORDER BY m.received_at DESC, m.id DESC, url.ordinality
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      messageId: row.message_id,
      position: row.position,
      url: row.url,
    }));
  }

  async markAttachmentPermanentlyFailed(messageId: string, position: number): Promise<void> {
    const token = `,${position},`;
    await this.pool.query(
      `UPDATE messages
          SET last_error = CASE
            WHEN position($2 IN COALESCE(last_error, '')) > 0 THEN last_error
            WHEN last_error LIKE 'ATTACHMENT_PERMANENT:%' THEN last_error || $3
            ELSE 'ATTACHMENT_PERMANENT:' || $2
          END
        WHERE id = $1 AND direction = 'INBOUND'`,
      [messageId, token, `${position},`],
    );
  }

  async getAttachment(id: string): Promise<{ contentType: string; data: Buffer } | null> {
    const result = await this.pool.query<{
      content_type: string;
      data: Buffer;
    }>("SELECT content_type, data FROM message_attachments WHERE id = $1", [id]);
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

  private async lockAdminMessage(
    client: PoolClient,
    id: string,
  ): Promise<{
    status: MessageStatus;
    live_lease: boolean;
    resolved_contact_id: string | null;
  } | null> {
    const result = await client.query<{
      status: MessageStatus;
      live_lease: boolean;
      resolved_contact_id: string | null;
    }>(
      `SELECT m.status,
              m.status = 'QUEUED' AND m.locked_until > clock_timestamp() AS live_lease,
              CASE
                WHEN m.reservation_id IS NOT NULL THEN r.contact_id
                WHEN m.waitlist_entry_id IS NOT NULL THEN w.contact_id
                ELSE m.contact_id
              END AS resolved_contact_id
         FROM messages m
         LEFT JOIN reservations r ON r.id = m.reservation_id
         LEFT JOIN waitlist_entries w ON w.id = m.waitlist_entry_id
        WHERE m.id = $1 AND m.direction = 'OUTBOUND'
        FOR UPDATE OF m`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async retryMessage(id: string): Promise<AdminMessageMutationResult> {
    return this.withTransaction(async (client) => {
      const row = await this.lockAdminMessage(client, id);
      if (!row) return "NOT_UPDATED";
      if (row.live_lease) return "LIVE_LEASE";
      if (
        !["FAILED", "WAITING_WINDOW", "WAITING_CONTACT"].includes(row.status) ||
        !row.resolved_contact_id
      ) {
        return "NOT_UPDATED";
      }
      await client.query(
        `UPDATE messages
            SET parts_sent = CASE
                  WHEN contact_id IS NOT NULL AND contact_id IS DISTINCT FROM $2
                    THEN 0 ELSE parts_sent END,
                external_part_ids = CASE
                  WHEN contact_id IS NOT NULL AND contact_id IS DISTINCT FROM $2
                    THEN NULL ELSE external_part_ids END,
                contact_id = $2, status = 'QUEUED', attempts = 0,
                claims_without_progress = 0,
                next_attempt_at = clock_timestamp(), locked_until = NULL, last_error = NULL
          WHERE id = $1`,
        [id, row.resolved_contact_id],
      );
      return "UPDATED";
    });
  }

  async markSentManually(id: string, adminId: string): Promise<AdminMessageMutationResult> {
    return this.withTransaction(async (client) => {
      const row = await this.lockAdminMessage(client, id);
      if (!row) return "NOT_UPDATED";
      if (row.live_lease) return "LIVE_LEASE";
      if (!["WAITING_CONTACT", "WAITING_WINDOW", "QUEUED", "FAILED"].includes(row.status)) {
        return "NOT_UPDATED";
      }
      await client.query(
        `UPDATE messages
            SET status = 'SENT_MANUALLY', sent_at = clock_timestamp(),
                handled_by = $2, locked_until = NULL, last_error = NULL,
                claims_without_progress = 0
          WHERE id = $1`,
        [id, adminId],
      );
      return "UPDATED";
    });
  }

  async discardMessage(id: string, adminId: string): Promise<AdminMessageMutationResult> {
    return this.withTransaction(async (client) => {
      const row = await this.lockAdminMessage(client, id);
      if (!row) return "NOT_UPDATED";
      if (row.live_lease) return "LIVE_LEASE";
      if (!["WAITING_CONTACT", "WAITING_WINDOW", "QUEUED"].includes(row.status)) {
        return "NOT_UPDATED";
      }
      await client.query(
        `UPDATE messages
            SET status = 'DISCARDED', handled_by = $2, locked_until = NULL,
                claims_without_progress = 0
          WHERE id = $1`,
        [id, adminId],
      );
      return "UPDATED";
    });
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
      const current = await client.query<{ contact_id: string | null }>(
        `SELECT contact_id FROM ${table} WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!current.rows[0]) return false;
      await client.query(
        `UPDATE ${table}
            SET contact_id = $1, contact_linked_by = 'MANUAL', updated_at = clock_timestamp()
          WHERE id = $2`,
        [contactId, id],
      );
      await this.retargetSubjectMessages(client, idColumn, id, contactId);
      await this.auditContactLinked(client, {
        actorAdminId: adminId,
        entityType,
        entityId: id,
        contactId,
        previousContactId: current.rows[0].contact_id,
        method: "MANUAL",
      });
      return true;
    });
  }

  async linkContactByCode(contactId: string, code: string, adminId: string): Promise<number> {
    return this.withTransaction(async (client) => {
      const contact = await client.query("SELECT 1 FROM messaging_contacts WHERE id = $1", [
        contactId,
      ]);
      if ((contact.rowCount ?? 0) === 0) return 0;
      const result = await this.linkByCode(client, contactId, code, "MANUAL", adminId);
      return result.linked;
    });
  }

  async unlinkContact(
    contactId: string,
    subject: MessageSubject,
    adminId: string,
  ): Promise<AdminMessageMutationResult> {
    return this.withTransaction(async (client) => {
      const reservation = "reservationId" in subject;
      const table = reservation ? "reservations" : "waitlist_entries";
      const id = reservation ? subject.reservationId : subject.waitlistEntryId;
      const idColumn = reservation ? "reservation_id" : "waitlist_entry_id";
      const entityType = reservation ? "RESERVATION" : "WAITLIST_ENTRY";
      const current = await client.query(
        `SELECT 1 FROM ${table} WHERE id = $1 AND contact_id = $2 FOR UPDATE`,
        [id, contactId],
      );
      if (current.rowCount !== 1) return "NOT_UPDATED";
      const pending = await client.query<{ live_lease: boolean }>(
        `SELECT status = 'QUEUED' AND locked_until > clock_timestamp() AS live_lease
           FROM messages
          WHERE ${idColumn} = $1
            AND status IN ('QUEUED', 'WAITING_WINDOW', 'FAILED')
          FOR UPDATE`,
        [id],
      );
      if (pending.rows.some((row) => row.live_lease)) return "LIVE_LEASE";
      await client.query(
        `UPDATE ${table}
            SET contact_id = NULL, contact_linked_by = NULL, updated_at = clock_timestamp()
          WHERE id = $1`,
        [id],
      );
      await client.query(
        `UPDATE messages
            SET contact_id = NULL, status = 'WAITING_CONTACT',
                parts_sent = 0, external_part_ids = NULL, attempts = 0,
                claims_without_progress = 0, locked_until = NULL, last_error = NULL
          WHERE ${idColumn} = $1 AND contact_id = $2
            AND status IN ('QUEUED', 'WAITING_WINDOW', 'FAILED')`,
        [id, contactId],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         ) VALUES ('ADMIN', $1, 'MESSAGING_CONTACT_UNLINKED', $2, $3, $4::jsonb)`,
        [adminId, entityType, id, JSON.stringify({ contactId })],
      );
      return "UPDATED";
    });
  }

  async isBlockedByWaitingWindow(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
         FROM messages target
         JOIN messages older ON older.contact_id = target.contact_id
        WHERE target.id = $1
          AND older.direction = 'OUTBOUND'
          AND older.status = 'WAITING_WINDOW'
          AND (older.created_at, older.id) < (target.created_at, target.id)
        LIMIT 1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
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
      event_id: string;
      event_name: string;
      starts_at: Date;
      full_name: string;
      guest2_full_name: string | null;
      instagram_handle: string;
      guest2_instagram_handle: string | null;
      status: string;
      stage: string | null;
    }>(
      `SELECT r.contact_id, r.id, 'RESERVATION'::text AS type, r.event_id,
              e.internal_name AS event_name, e.starts_at, r.full_name,
              r.guest2_full_name, r.instagram_handle, r.guest2_instagram_handle,
              r.status::text, r.stage
         FROM reservations r JOIN events e ON e.id = r.event_id
        WHERE r.contact_id = ANY($1::uuid[])
       UNION ALL
       SELECT w.contact_id, w.id, 'WAITLIST_ENTRY'::text AS type, w.event_id,
              e.internal_name, e.starts_at, w.full_name,
              w.guest2_full_name, w.instagram_handle, w.guest2_instagram_handle,
              w.status, NULL::text
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
        eventId: row.event_id,
        eventName: row.event_name,
        eventStartsAt: row.starts_at,
        guests: [row.full_name, row.guest2_full_name].filter((name): name is string =>
          Boolean(name),
        ),
        instagramHandles: [row.instagram_handle, row.guest2_instagram_handle].filter(
          (handle): handle is string => Boolean(handle),
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
                    AND unread.received_at > COALESCE(contact.admin_read_at, '-infinity')) AS unread_count
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
      attachment_urls: string[] | null;
      last_error: string | null;
      sent_at: Date | null;
      read_at: Date | null;
      created_at: Date;
      attachment_ids: string[];
    }>(
      `SELECT m.id, m.direction, m.kind, m.source, m.status, m.body, m.attachment_urls,
              m.last_error,
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
      attachmentUrls: row.direction === "OUTBOUND" ? (row.attachment_urls ?? []) : [],
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
             AND m.received_at > COALESCE(contact.admin_read_at, '-infinity')
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

export const postgresMessageRepository = new PostgresMessageRepository(
  applicationPool,
  env.INSTAGRAM_ACCOUNT_ID ?? null,
);
