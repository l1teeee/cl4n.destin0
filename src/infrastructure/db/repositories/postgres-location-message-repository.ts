import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  LocationDeliverySummary,
  LocationMessageRepository,
  QueueLocationMessageResult,
  SendLocationToPaidGuestsResult,
} from "@/application/events/location-message-repository";
import type { LoadedLocationVersion } from "@/application/events/types";
import type { EventLocationStatus } from "@/domain/event/event-location";
import {
  composeLocationText,
  fitsInMessageBody,
  MAX_LOCATION_PHOTOS,
} from "@/domain/messaging/location-message";
import { locationPhotoUrl } from "@/domain/messaging/message-attachment-urls";
import { renderMessageTemplate } from "@/domain/messaging/message-template";
import { firstName, guestFirstNames } from "@/domain/reservation/guest-names";
import { env } from "@/infrastructure/config/env";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

import { pool as applicationPool } from "../client";
import { isLockOrStatementTimeout } from "../retryable-database-error";
import { inTransaction } from "../transaction";

interface LocationEventRow extends QueryResultRow {
  status: "DRAFT" | "SCHEDULED" | "CLOSED" | "COMPLETED" | "CANCELLED";
  starts_at: Date;
  location_status: EventLocationStatus;
  location_revision: number;
  location_name: string | null;
  location_address: string | null;
  location_notes: string | null;
  location_maps_url: string | null;
}

interface PaidGuestRow extends QueryResultRow {
  id: string;
  full_name: string;
  guest2_full_name: string | null;
}

interface SummaryRow extends QueryResultRow {
  paid: number;
  received: number;
  pending: number;
  failed: number;
  never_queued: number;
  outdated: number;
  last_delivered_at: Date | null;
}

interface LocationMessageContext {
  eventId: string;
  revision: number;
  template: string;
  startsAt: Date;
  locationText: string;
  photoUrls: string[];
}

interface LocationDraft {
  reservationId: string;
  body: string;
}

interface MessageOrigin {
  source: "SYSTEM" | "ADMIN";
  createdBy: string | null;
}

// A held event lock (allocation, edits, cancellations) must surface as TRY_AGAIN, not hang the admin.
const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

const eventLocationColumns = `status, starts_at, location_status, location_revision, location_name,
  location_address, location_notes, location_maps_url`;

// The caller of queueLocationMessage already holds the event row lock.
async function readEventLocation(
  client: PoolClient,
  eventId: string,
): Promise<LocationEventRow | null> {
  const result = await client.query<LocationEventRow>(
    `SELECT ${eventLocationColumns} FROM events WHERE id = $1`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

async function lockEventLocation(
  client: PoolClient,
  eventId: string,
): Promise<LocationEventRow | null> {
  const result = await client.query<LocationEventRow>(
    `SELECT ${eventLocationColumns}
       FROM events
      WHERE id = $1
        AND deleted_at IS NULL
        FOR UPDATE`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

async function readPaidGuest(
  client: PoolClient,
  eventId: string,
  reservationId: string,
): Promise<PaidGuestRow | null> {
  const result = await client.query<PaidGuestRow>(
    `SELECT id, full_name, guest2_full_name
       FROM reservations
      WHERE id = $1
        AND event_id = $2
        AND status = 'CONFIRMED'
        AND stage = 'PAID'`,
    [reservationId, eventId],
  );
  return result.rows[0] ?? null;
}

async function readPaidGuestsWithoutMessage(
  client: PoolClient,
  eventId: string,
  locationRevision: number,
): Promise<PaidGuestRow[]> {
  const result = await client.query<PaidGuestRow>(
    `SELECT r.id, r.full_name, r.guest2_full_name
       FROM reservations r
      WHERE r.event_id = $1
        AND r.status = 'CONFIRMED'
        AND r.stage = 'PAID'
        AND NOT EXISTS (
          SELECT 1
            FROM messages m
           WHERE m.reservation_id = r.id
             AND m.kind = 'LOCATION'
             AND m.location_revision = $2
        )
      ORDER BY r.reservation_number, r.id`,
    [eventId, locationRevision],
  );
  return result.rows;
}

async function readLocationTemplate(client: PoolClient): Promise<string> {
  const result = await client.query<{ body: string }>(
    "SELECT body FROM message_templates WHERE key = 'LOCATION'",
  );
  const template = result.rows[0];
  if (!template) {
    throw new Error("Message template LOCATION not found");
  }
  return template.body;
}

async function readPhotoUrls(client: PoolClient, eventId: string): Promise<string[]> {
  const result = await client.query<{ public_token: string }>(
    `SELECT public_token
       FROM event_images
      WHERE event_id = $1
      ORDER BY created_at, id
      LIMIT $2`,
    [eventId, MAX_LOCATION_PHOTOS],
  );
  return result.rows.map((row) => locationPhotoUrl(env.APP_BASE_URL, row.public_token));
}

async function buildContext(
  client: PoolClient,
  eventId: string,
  event: LocationEventRow,
): Promise<LocationMessageContext> {
  return {
    eventId,
    revision: event.location_revision,
    template: await readLocationTemplate(client),
    startsAt: event.starts_at,
    locationText: composeLocationText({
      name: event.location_name,
      address: event.location_address,
      notes: event.location_notes,
      mapsUrl: event.location_maps_url,
    }),
    photoUrls: await readPhotoUrls(client, eventId),
  };
}

function renderLocationBody(context: LocationMessageContext, guest: PaidGuestRow): string {
  return renderMessageTemplate(context.template, {
    nombre: firstName(guest.full_name),
    nombres: guestFirstNames(guest.full_name, guest.guest2_full_name),
    fecha: formatPublicEventDate(context.startsAt),
    ubicacion: context.locationText,
  });
}

// Never truncates: one body over the limit blocks the whole batch.
function draftLocationMessages(
  context: LocationMessageContext,
  guests: readonly PaidGuestRow[],
): LocationDraft[] | "TOO_LONG" {
  const drafts: LocationDraft[] = [];
  for (const guest of guests) {
    const body = renderLocationBody(context, guest);
    if (!fitsInMessageBody(body, context.photoUrls.length)) {
      return "TOO_LONG";
    }
    drafts.push({ reservationId: guest.id, body });
  }
  return drafts;
}

async function insertLocationMessages(
  client: PoolClient,
  context: LocationMessageContext,
  drafts: readonly LocationDraft[],
  origin: MessageOrigin,
): Promise<string[]> {
  if (drafts.length === 0) {
    return [];
  }

  // created_at is the real insert time, not the transaction start, which can predate a wait for the
  // event lock: chat order and per-contact delivery order then follow the moment it was queued.
  // FOR SHARE makes the insert wait for a concurrent link or unlink of the conversation and then
  // read the new contact, so a QUEUED row can never be left on a contact that was just unlinked.
  const result = await client.query<{ id: string }>(
    `WITH paid_guests AS (
       SELECT r.id, r.contact_id, r.event_id
         FROM reservations r
        WHERE r.id = ANY($1::uuid[])
          AND r.event_id = $7::uuid
          AND r.status = 'CONFIRMED'
          AND r.stage = 'PAID'
          FOR SHARE OF r
     )
     INSERT INTO messages (
       contact_id, reservation_id, event_id, direction, kind, source, status,
       body, attachment_urls, location_revision, created_by, created_at
     )
     SELECT guest.contact_id, guest.id, guest.event_id, 'OUTBOUND', 'LOCATION', $4::text,
            CASE WHEN guest.contact_id IS NULL THEN 'WAITING_CONTACT' ELSE 'QUEUED' END,
            draft.body, $5::text[], $3::integer, $6::uuid, clock_timestamp()
       FROM unnest($1::uuid[], $2::text[]) AS draft(reservation_id, body)
       JOIN paid_guests guest ON guest.id = draft.reservation_id
     ON CONFLICT (reservation_id, location_revision) WHERE kind = 'LOCATION'
     DO NOTHING
     RETURNING id`,
    [
      drafts.map((draft) => draft.reservationId),
      drafts.map((draft) => draft.body),
      context.revision,
      origin.source,
      context.photoUrls.length > 0 ? context.photoUrls : null,
      origin.createdBy,
      context.eventId,
    ],
  );
  return result.rows.map((row) => row.id);
}

// FAILED and DISCARDED rows of the current revision are retried instead of skipped. This is an
// explicit admin resend, so progress is reset and the text may be sent again: the photos can have
// changed since the row was queued, and a different or missing conversation cannot reuse old parts.
async function reviveUndeliveredMessages(
  client: PoolClient,
  context: LocationMessageContext,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `UPDATE messages m
        SET contact_id = r.contact_id,
            status = CASE WHEN r.contact_id IS NULL THEN 'WAITING_CONTACT' ELSE 'QUEUED' END,
            attachment_urls = $3::text[],
            parts_sent = 0,
            external_part_ids = NULL,
            attempts = 0,
            claims_without_progress = 0,
            next_attempt_at = clock_timestamp(),
            locked_until = NULL,
            last_error = NULL
       FROM reservations r
      WHERE r.id = m.reservation_id
        AND r.event_id = $1
        AND r.status = 'CONFIRMED'
        AND r.stage = 'PAID'
        AND m.kind = 'LOCATION'
        AND m.location_revision = $2
        AND m.status IN ('FAILED', 'DISCARDED')
    RETURNING m.id`,
    [context.eventId, context.revision, context.photoUrls.length > 0 ? context.photoUrls : null],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Photo changes must not leave a pending LOCATION message pointing at a deleted photo. Only rows
 * that have not started delivering (no parts sent, no live lease) are rewritten, so a message that
 * is already going out is never changed underneath the delivery loop. It reads the events row
 * without locking it, which keeps ADR-005 decision 5 for image operations.
 */
export async function refreshPendingLocationPhotos(
  client: PoolClient,
  eventId: string,
): Promise<void> {
  const photoUrls = await readPhotoUrls(client, eventId);
  await client.query(
    `UPDATE messages m
        SET attachment_urls = $2::text[]
       FROM events e
      WHERE e.id = $1
        AND m.event_id = e.id
        AND m.kind = 'LOCATION'
        AND m.location_revision = e.location_revision
        AND m.status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED')
        AND m.parts_sent = 0
        AND (m.locked_until IS NULL OR m.locked_until <= clock_timestamp())
        AND m.attachment_urls IS DISTINCT FROM $2::text[]`,
    [eventId, photoUrls.length > 0 ? photoUrls : null],
  );
}

async function markRevisionReleased(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `UPDATE events
        SET location_released_revision = location_revision,
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [eventId],
  );
}

async function recordLocationSent(
  client: PoolClient,
  adminId: string,
  eventId: string,
  locationRevision: number,
  messageCount: number,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, actor_admin_id, action, entity_type, entity_id, metadata
     ) VALUES ('ADMIN', $1, 'EVENT_UPDATED', 'EVENT', $2, $3::jsonb)`,
    [adminId, eventId, JSON.stringify({ locationMessagesQueued: messageCount, locationRevision })],
  );
}

/**
 * The caller must already hold the event row lock (payment verification does).
 * A location that does not fit in one message is skipped, never truncated, so the payment still commits.
 */
export async function queueLocationMessage(
  client: PoolClient,
  eventId: string,
  reservationId: string,
): Promise<QueueLocationMessageResult> {
  const event = await readEventLocation(client, eventId);
  if (!event || event.location_status !== "CONFIRMED") {
    return { outcome: "NOT_APPLICABLE" };
  }
  const guest = await readPaidGuest(client, eventId, reservationId);
  if (!guest) {
    return { outcome: "NOT_APPLICABLE" };
  }

  const context = await buildContext(client, eventId, event);
  const drafts = draftLocationMessages(context, [guest]);
  if (drafts === "TOO_LONG") {
    return { outcome: "TOO_LONG" };
  }

  const [messageId] = await insertLocationMessages(client, context, drafts, {
    source: "SYSTEM",
    createdBy: null,
  });
  return messageId ? { outcome: "QUEUED", messageId } : { outcome: "ALREADY_QUEUED" };
}

async function sendLocationInTransaction(
  client: PoolClient,
  eventId: string,
  expectedLocation: LoadedLocationVersion,
  adminId: string,
): Promise<SendLocationToPaidGuestsResult> {
  const event = await lockEventLocation(client, eventId);
  if (!event) {
    return { ok: false, error: "EVENT_NOT_FOUND" };
  }
  if (event.status === "CANCELLED" || event.status === "COMPLETED") {
    return { ok: false, error: "EVENT_NOT_EDITABLE" };
  }
  if (
    event.location_revision !== expectedLocation.revision ||
    event.location_status !== expectedLocation.status
  ) {
    return { ok: false, error: "LOCATION_CHANGED" };
  }
  if (event.location_status !== "CONFIRMED") {
    return { ok: false, error: "LOCATION_NOT_CONFIRMED" };
  }

  const context = await buildContext(client, eventId, event);
  const guests = await readPaidGuestsWithoutMessage(client, eventId, context.revision);
  const drafts = draftLocationMessages(context, guests);
  if (drafts === "TOO_LONG") {
    return { ok: false, error: "LOCATION_TOO_LONG" };
  }

  const insertedIds = await insertLocationMessages(client, context, drafts, {
    source: "ADMIN",
    createdBy: adminId,
  });
  const revivedIds = await reviveUndeliveredMessages(client, context);
  await markRevisionReleased(client, eventId);

  const messageIds = [...insertedIds, ...revivedIds];
  await recordLocationSent(client, adminId, eventId, context.revision, messageIds.length);
  return { ok: true, messageIds, locationRevision: context.revision };
}

export class PostgresLocationMessageRepository implements LocationMessageRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async sendLocationToPaidGuests(
    eventId: string,
    expectedLocation: LoadedLocationVersion,
    adminId: string,
  ): Promise<SendLocationToPaidGuestsResult> {
    try {
      return await inTransaction(this.pool, transactionSettings, (client) =>
        sendLocationInTransaction(client, eventId, expectedLocation, adminId),
      );
    } catch (error) {
      if (isLockOrStatementTimeout(error)) {
        return { ok: false, error: "TRY_AGAIN" };
      }
      throw error;
    }
  }

  async getLocationDeliverySummary(eventId: string): Promise<LocationDeliverySummary> {
    const result = await this.pool.query<SummaryRow>(
      `WITH paid_guests AS (
         SELECT r.id, e.location_revision
           FROM reservations r
           JOIN events e ON e.id = r.event_id
          WHERE r.event_id = $1
            AND r.status = 'CONFIRMED'
            AND r.stage = 'PAID'
       ), guest_delivery AS (
         SELECT current_message.status AS current_status,
                current_message.sent_at AS current_sent_at,
                EXISTS (
                  SELECT 1
                    FROM messages older
                   WHERE older.reservation_id = guest.id
                     AND older.kind = 'LOCATION'
                     AND older.location_revision < guest.location_revision
                     AND older.status IN ('SENT', 'READ', 'SENT_MANUALLY')
                ) AS older_revision_delivered
           FROM paid_guests guest
           LEFT JOIN messages current_message
             ON current_message.reservation_id = guest.id
            AND current_message.kind = 'LOCATION'
            AND current_message.location_revision = guest.location_revision
       )
       SELECT count(*)::int AS paid,
              count(*) FILTER (
                WHERE current_status IN ('SENT', 'READ', 'SENT_MANUALLY')
              )::int AS received,
              count(*) FILTER (
                WHERE current_status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED')
              )::int AS pending,
              count(*) FILTER (WHERE current_status = 'FAILED')::int AS failed,
              count(*) FILTER (
                WHERE (current_status IS NULL OR current_status = 'DISCARDED')
                  AND NOT older_revision_delivered
              )::int AS never_queued,
              count(*) FILTER (
                WHERE (current_status IS NULL OR current_status = 'DISCARDED')
                  AND older_revision_delivered
              )::int AS outdated,
              max(current_sent_at) FILTER (
                WHERE current_status IN ('SENT', 'READ', 'SENT_MANUALLY')
              ) AS last_delivered_at
         FROM guest_delivery`,
      [eventId],
    );
    const row = result.rows[0]!;
    return {
      paid: row.paid,
      received: row.received,
      pending: row.pending,
      failed: row.failed,
      neverQueued: row.never_queued,
      outdated: row.outdated,
      lastDeliveredAt: row.last_delivered_at,
    };
  }
}

export const postgresLocationMessageRepository = new PostgresLocationMessageRepository();
