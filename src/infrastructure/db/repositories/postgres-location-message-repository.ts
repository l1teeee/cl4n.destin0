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
import { retryableDatabaseErrorCode } from "../retryable-database-error";
import { inTransaction } from "../transaction";

interface LocationEventRow extends QueryResultRow {
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

// Only the two timeouts mean "the event row was busy, try again"; any other failure must surface.
function isLockOrStatementTimeout(error: unknown): boolean {
  const code = retryableDatabaseErrorCode(error);
  return code === "55P03" || code === "57014";
}

const eventLocationColumns = `starts_at, location_status, location_revision, location_name,
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
    if (!fitsInMessageBody(body)) {
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
  const result = await client.query<{ id: string }>(
    `INSERT INTO messages (
       contact_id, reservation_id, event_id, direction, kind, source, status,
       body, attachment_urls, location_revision, created_by, created_at
     )
     SELECT r.contact_id, r.id, r.event_id, 'OUTBOUND', 'LOCATION', $4::text,
            CASE WHEN r.contact_id IS NULL THEN 'WAITING_CONTACT' ELSE 'QUEUED' END,
            draft.body, $5::text[], $3::integer, $6::uuid, clock_timestamp()
       FROM unnest($1::uuid[], $2::text[]) AS draft(reservation_id, body)
       JOIN reservations r ON r.id = draft.reservation_id
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
    ],
  );
  return result.rows.map((row) => row.id);
}

// FAILED and DISCARDED rows of the current revision are retried instead of skipped.
async function reviveUndeliveredMessages(
  client: PoolClient,
  eventId: string,
  locationRevision: number,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `UPDATE messages m
        SET contact_id = r.contact_id,
            status = CASE WHEN r.contact_id IS NULL THEN 'WAITING_CONTACT' ELSE 'QUEUED' END,
            attempts = 0,
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
    [eventId, locationRevision],
  );
  return result.rows.map((row) => row.id);
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
  const revivedIds = await reviveUndeliveredMessages(client, eventId, context.revision);
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
