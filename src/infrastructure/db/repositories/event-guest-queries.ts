import type { Pool, QueryResultRow } from "pg";

import { EVENT_GUEST_VIEWS, type EventGuestView } from "@/application/guests/guest-views";
import { getRequestMessages } from "@/application/messaging/conversation-queries";
import type { ConversationMessage } from "@/application/messaging/conversation-queries";
import type { MessageKind, MessageStatus } from "@/domain/messaging/message-types";

import { pool as applicationPool } from "../client";
import { postgresMessageRepository } from "./postgres-message-repository";

export { EVENT_GUEST_VIEWS };
export type { EventGuestView };
export type GuestRequestKind = "RESERVATION" | "WAITLIST_ENTRY";

export interface GuestLastMessage {
  kind: MessageKind;
  status: MessageStatus;
  lastError: string | null;
  sentAt: Date | null;
}

export interface EventGuestRow {
  kind: GuestRequestKind;
  id: string;
  number: number | null;
  position: number | null;
  guest1Name: string;
  guest1Instagram: string;
  guest2Name: string | null;
  guest2Instagram: string | null;
  partySize: number;
  allergies: string | null;
  notes: string | null;
  status: string;
  stage: "IN_REVIEW" | "ON_LIST" | "PAID" | null;
  releaseReason: "REJECTED" | "CANCELLED" | null;
  refundStatus: "PENDING" | "REFUNDED" | null;
  source: "PUBLIC" | "ADMIN";
  submittedAt: Date;
  onListAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  linkCode: string | null;
  contactId: string | null;
  contactUsername: string | null;
  lastMessage: GuestLastMessage | null;
}

export interface EventGuestCounts {
  counts: Record<EventGuestView, number>;
  occupiedSeats: number;
  capacity: number;
  waitlisted: number;
  waitlistCapacity: number;
  pendingMessages: number;
}

export interface PromotionPreviewEntry {
  id: string;
  guests: string[];
}

export interface PromotionPreview {
  oneSeat: PromotionPreviewEntry[];
  twoSeats: PromotionPreviewEntry[];
}

export interface GuestTimelineEntry {
  label: "Recibida" | "En la lista" | "Pago verificado" | "Cancelada" | "Reembolsada";
  at: Date;
}

export interface GuestRequestDetail extends EventGuestRow {
  timeline: GuestTimelineEntry[];
  messages: ConversationMessage[];
}

interface GuestRecord extends QueryResultRow {
  kind: GuestRequestKind;
  id: string;
  number: number | null;
  position: number | null;
  guest1_name: string;
  guest1_instagram: string;
  guest2_name: string | null;
  guest2_instagram: string | null;
  party_size: number;
  allergies: string | null;
  notes: string | null;
  status: string;
  stage: EventGuestRow["stage"];
  release_reason: EventGuestRow["releaseReason"];
  refund_status: EventGuestRow["refundStatus"];
  source: EventGuestRow["source"];
  submitted_at: Date;
  on_list_at: Date | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
  refunded_at: Date | null;
  link_code: string | null;
  contact_id: string | null;
  contact_username: string | null;
  message_kind: MessageKind | null;
  message_status: MessageStatus | null;
  message_last_error: string | null;
  message_sent_at: Date | null;
}

const guestRequestsCte = `
  waiting_positions AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY waitlist_number, id)::int AS position
      FROM waitlist_entries
     WHERE event_id = $1
       AND status = 'WAITING'
  ),
  guest_requests AS (
    SELECT 'RESERVATION'::text AS kind,
           r.id,
           r.reservation_number AS number,
           NULL::int AS position,
           r.full_name AS guest1_name,
           r.instagram_handle AS guest1_instagram,
           r.guest2_full_name AS guest2_name,
           r.guest2_instagram_handle AS guest2_instagram,
           r.party_size,
           r.allergies,
           r.notes,
           r.status::text,
           r.stage,
           r.release_reason,
           r.refund_status,
           r.source,
           r.submitted_at,
           r.on_list_at,
           r.paid_at,
           r.cancelled_at,
           r.refunded_at,
           r.link_code,
           r.contact_id
      FROM reservations r
      JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
     WHERE r.event_id = $1
       AND r.status IN ('CONFIRMED', 'CANCELLED', 'FULL_REJECTED')
    UNION ALL
    SELECT 'WAITLIST_ENTRY',
           w.id,
           w.waitlist_number,
           p.position,
           w.full_name,
           w.instagram_handle,
           w.guest2_full_name,
           w.guest2_instagram_handle,
           w.party_size,
           w.allergies,
           w.notes,
           w.status,
           NULL::text,
           NULL::text,
           NULL::text,
           w.source,
           w.submitted_at,
           NULL::timestamptz,
           NULL::timestamptz,
           w.cancelled_at,
           NULL::timestamptz,
           w.link_code,
           w.contact_id
      FROM waitlist_entries w
      JOIN events e ON e.id = w.event_id AND e.deleted_at IS NULL
      LEFT JOIN waiting_positions p ON p.id = w.id
     WHERE w.event_id = $1
       AND w.status IN ('WAITING', 'CANCELLED')
  )`;

const filters: Record<EventGuestView, string> = {
  "por-revisar": "request.status = 'CONFIRMED' AND request.stage = 'IN_REVIEW'",
  "en-la-lista": "request.status = 'CONFIRMED' AND request.stage = 'ON_LIST'",
  confirmados: "request.status = 'CONFIRMED' AND request.stage = 'PAID'",
  cola: "request.kind = 'WAITLIST_ENTRY' AND request.status = 'WAITING'",
  descartados: "request.status = 'CANCELLED'",
  "sin-lugar": "request.kind = 'RESERVATION' AND request.status = 'FULL_REJECTED'",
  todas: "true",
};

const ordering: Record<EventGuestView, string> = {
  "por-revisar": "request.number ASC NULLS LAST, request.id",
  "en-la-lista": "request.on_list_at ASC NULLS LAST, request.id",
  confirmados: "request.paid_at ASC NULLS LAST, request.id",
  cola: "request.number ASC, request.id",
  descartados: "request.cancelled_at DESC NULLS LAST, request.id",
  "sin-lugar": "request.submitted_at DESC, request.id",
  todas: "request.submitted_at DESC, request.id",
};

function toGuestRow(row: GuestRecord): EventGuestRow {
  return {
    kind: row.kind,
    id: row.id,
    number: row.number,
    position: row.position,
    guest1Name: row.guest1_name,
    guest1Instagram: row.guest1_instagram,
    guest2Name: row.guest2_name,
    guest2Instagram: row.guest2_instagram,
    partySize: row.party_size,
    allergies: row.allergies,
    notes: row.notes,
    status: row.status,
    stage: row.stage,
    releaseReason: row.release_reason,
    refundStatus: row.refund_status,
    source: row.source,
    submittedAt: row.submitted_at,
    onListAt: row.on_list_at,
    paidAt: row.paid_at,
    cancelledAt: row.cancelled_at,
    refundedAt: row.refunded_at,
    linkCode: row.link_code,
    contactId: row.contact_id,
    contactUsername: row.contact_username,
    lastMessage:
      row.message_kind === null || row.message_status === null
        ? null
        : {
            kind: row.message_kind,
            status: row.message_status,
            lastError: row.message_last_error,
            sentAt: row.message_sent_at,
          },
  };
}

export async function listEventGuests(
  eventId: string,
  view: EventGuestView,
  targetPool: Pool = applicationPool,
): Promise<EventGuestRow[]> {
  const result = await targetPool.query<GuestRecord>(
    `WITH ${guestRequestsCte}
     SELECT request.*,
            contact.username AS contact_username,
            last_message.kind AS message_kind,
            last_message.status AS message_status,
            last_message.last_error AS message_last_error,
            last_message.sent_at AS message_sent_at
       FROM guest_requests request
       LEFT JOIN messaging_contacts contact ON contact.id = request.contact_id
       LEFT JOIN LATERAL (
         SELECT kind, status, last_error, sent_at
           FROM messages message
          WHERE message.direction = 'OUTBOUND'
            AND (
              (request.kind = 'RESERVATION' AND message.reservation_id = request.id)
              OR
              (request.kind = 'WAITLIST_ENTRY' AND message.waitlist_entry_id = request.id)
            )
          ORDER BY message.created_at DESC, message.id DESC
          LIMIT 1
       ) last_message ON true
      WHERE ${filters[view]}
      ORDER BY ${ordering[view]}`,
    [eventId],
  );
  return result.rows.map(toGuestRow);
}

export async function countEventGuests(
  eventId: string,
  targetPool: Pool = applicationPool,
): Promise<EventGuestCounts> {
  const result = await targetPool.query<{
    capacity: number;
    reserved_seats: number;
    waitlist_capacity: number;
    waitlisted_count: number;
    in_review: number;
    on_list: number;
    paid: number;
    discarded: number;
    full_rejected: number;
    pending_messages: number;
  }>(
    `SELECT e.capacity,
            e.reserved_seats,
            e.waitlist_capacity,
            e.waitlisted_count,
            COUNT(*) FILTER (
              WHERE request.kind = 'RESERVATION'
                AND request.status = 'CONFIRMED'
                AND request.stage = 'IN_REVIEW'
            )::int AS in_review,
            COUNT(*) FILTER (
              WHERE request.kind = 'RESERVATION'
                AND request.status = 'CONFIRMED'
                AND request.stage = 'ON_LIST'
            )::int AS on_list,
            COUNT(*) FILTER (
              WHERE request.kind = 'RESERVATION'
                AND request.status = 'CONFIRMED'
                AND request.stage = 'PAID'
            )::int AS paid,
            COUNT(*) FILTER (WHERE request.status = 'CANCELLED')::int AS discarded,
            COUNT(*) FILTER (
              WHERE request.kind = 'RESERVATION' AND request.status = 'FULL_REJECTED'
            )::int AS full_rejected,
            (
              SELECT COUNT(*)::int
                FROM messages message
               WHERE message.event_id = e.id
                 AND message.direction = 'OUTBOUND'
                 AND message.status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'FAILED')
            ) AS pending_messages
       FROM events e
       LEFT JOIN LATERAL (
         SELECT 'RESERVATION'::text AS kind, status::text, stage
           FROM reservations
          WHERE event_id = e.id
            AND status IN ('CONFIRMED', 'CANCELLED', 'FULL_REJECTED')
         UNION ALL
         SELECT 'WAITLIST_ENTRY', status, NULL::text
           FROM waitlist_entries
          WHERE event_id = e.id
            AND status IN ('WAITING', 'CANCELLED')
       ) request ON true
      WHERE e.id = $1
        AND e.deleted_at IS NULL
      GROUP BY e.id`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      counts: {
        "por-revisar": 0,
        "en-la-lista": 0,
        confirmados: 0,
        cola: 0,
        descartados: 0,
        "sin-lugar": 0,
        todas: 0,
      },
      occupiedSeats: 0,
      capacity: 0,
      waitlisted: 0,
      waitlistCapacity: 0,
      pendingMessages: 0,
    };
  }
  const all =
    row.in_review +
    row.on_list +
    row.paid +
    row.waitlisted_count +
    row.discarded +
    row.full_rejected;
  return {
    counts: {
      "por-revisar": row.in_review,
      "en-la-lista": row.on_list,
      confirmados: row.paid,
      cola: row.waitlisted_count,
      descartados: row.discarded,
      "sin-lugar": row.full_rejected,
      todas: all,
    },
    occupiedSeats: row.reserved_seats,
    capacity: row.capacity,
    waitlisted: row.waitlisted_count,
    waitlistCapacity: row.waitlist_capacity,
    pendingMessages: row.pending_messages,
  };
}

function previewFor(
  rows: readonly {
    id: string;
    party_size: number;
    full_name: string;
    guest2_full_name: string | null;
  }[],
  availableSeats: number,
): PromotionPreviewEntry[] {
  const entries: PromotionPreviewEntry[] = [];
  let remaining = availableSeats;
  for (const row of rows) {
    if (row.party_size > remaining) break;
    remaining -= row.party_size;
    entries.push({
      id: row.id,
      guests: [row.full_name, row.guest2_full_name].filter((name): name is string => name !== null),
    });
  }
  return entries;
}

export async function previewPromotion(
  eventId: string,
  targetPool: Pool = applicationPool,
): Promise<PromotionPreview> {
  const [eventResult, entriesResult] = await Promise.all([
    targetPool.query<{ free_seats: number }>(
      `SELECT capacity - reserved_seats AS free_seats
         FROM events
        WHERE id = $1
          AND deleted_at IS NULL`,
      [eventId],
    ),
    targetPool.query<{
      id: string;
      party_size: number;
      full_name: string;
      guest2_full_name: string | null;
    }>(
      `SELECT id, party_size, full_name, guest2_full_name
         FROM waitlist_entries
        WHERE event_id = $1
          AND status = 'WAITING'
        ORDER BY waitlist_number, id`,
      [eventId],
    ),
  ]);
  const freeSeats = eventResult.rows[0]?.free_seats ?? 0;
  return {
    oneSeat: previewFor(entriesResult.rows, freeSeats + 1),
    twoSeats: previewFor(entriesResult.rows, freeSeats + 2),
  };
}

function timelineOf(row: EventGuestRow): GuestTimelineEntry[] {
  const timeline: GuestTimelineEntry[] = [{ label: "Recibida", at: row.submittedAt }];
  if (row.onListAt) timeline.push({ label: "En la lista", at: row.onListAt });
  if (row.paidAt) timeline.push({ label: "Pago verificado", at: row.paidAt });
  if (row.cancelledAt) timeline.push({ label: "Cancelada", at: row.cancelledAt });
  if (row.refundedAt) timeline.push({ label: "Reembolsada", at: row.refundedAt });
  return timeline.sort((left, right) => left.at.getTime() - right.at.getTime());
}

export async function getGuestRequestDetail(
  kind: GuestRequestKind,
  id: string,
  targetPool: Pool = applicationPool,
): Promise<GuestRequestDetail | null> {
  const eventResult = await targetPool.query<{ event_id: string }>(
    kind === "RESERVATION"
      ? "SELECT event_id FROM reservations WHERE id = $1"
      : "SELECT event_id FROM waitlist_entries WHERE id = $1",
    [id],
  );
  const eventId = eventResult.rows[0]?.event_id;
  if (!eventId) return null;
  const rows = await listEventGuests(eventId, "todas", targetPool);
  const row = rows.find((candidate) => candidate.kind === kind && candidate.id === id);
  if (!row) return null;
  const messages = await getRequestMessages(
    postgresMessageRepository,
    kind === "RESERVATION" ? { reservationId: id } : { waitlistEntryId: id },
  );
  return { ...row, timeline: timelineOf(row), messages };
}
