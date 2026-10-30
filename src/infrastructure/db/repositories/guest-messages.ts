import type { PoolClient } from "pg";

import { renderMessageTemplate } from "@/domain/messaging/message-template";
import type { MessageKind, TemplateKey } from "@/domain/messaging/message-types";
import { firstName, guestFirstNames } from "@/domain/reservation/guest-names";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

export type GuestMessageSubject = { reservationId: string } | { waitlistEntryId: string };

type OutboundMessageKind = Exclude<MessageKind, "INBOUND">;

interface EnqueuedMessageRow {
  id: string;
  status: "QUEUED" | "WAITING_CONTACT";
}

interface GuestMessageValueRow {
  full_name: string;
  guest2_full_name: string | null;
  starts_at: Date;
  payment_instructions: string | null;
  queue_position: number | null;
}

function subjectParameters(subject: GuestMessageSubject): [string, "reservation" | "waitlist"] {
  return "reservationId" in subject
    ? [subject.reservationId, "reservation"]
    : [subject.waitlistEntryId, "waitlist"];
}

export async function enqueueGuestMessage(
  client: PoolClient,
  input: {
    kind: OutboundMessageKind;
    subject: GuestMessageSubject;
    eventId: string;
    body: string | null;
    attachmentUrls?: string[];
    locationRevision?: number;
    clueId?: string;
    source: "SYSTEM" | "ADMIN";
    createdBy?: string;
  },
): Promise<EnqueuedMessageRow> {
  const [subjectId, subjectKind] = subjectParameters(input.subject);
  const result = await client.query<EnqueuedMessageRow>(
    `WITH guest_subject AS (
       SELECT contact_id
         FROM reservations
        WHERE id = $1::uuid
          AND $2::text = 'reservation'
       UNION ALL
       SELECT contact_id
         FROM waitlist_entries
        WHERE id = $1::uuid
          AND $2::text = 'waitlist'
     )
     INSERT INTO messages (
       contact_id, reservation_id, waitlist_entry_id, event_id,
       direction, kind, source, status, body, attachment_urls,
       location_revision, clue_id, created_by
     )
     SELECT contact_id,
            CASE WHEN $2::text = 'reservation' THEN $1::uuid END,
            CASE WHEN $2::text = 'waitlist' THEN $1::uuid END,
            $4::uuid, 'OUTBOUND', $3, $9,
            CASE WHEN contact_id IS NULL THEN 'WAITING_CONTACT' ELSE 'QUEUED' END,
            $5, $6::text[], $7, $8::uuid, $10::uuid
       FROM guest_subject
     RETURNING id, status`,
    [
      subjectId,
      subjectKind,
      input.kind,
      input.eventId,
      input.body,
      input.attachmentUrls ?? null,
      input.locationRevision ?? null,
      input.clueId ?? null,
      input.source,
      input.createdBy ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Guest message subject not found");
  }
  return row;
}

export async function renderGuestMessage(
  client: PoolClient,
  key: TemplateKey,
  values: Record<string, string>,
): Promise<string> {
  const result = await client.query<{ body: string }>(
    "SELECT body FROM message_templates WHERE key = $1",
    [key],
  );
  const template = result.rows[0];
  if (!template) {
    throw new Error(`Message template ${key} not found`);
  }
  return renderMessageTemplate(template.body, values);
}

export async function loadGuestMessageValues(
  client: PoolClient,
  subject: GuestMessageSubject,
): Promise<Record<string, string>> {
  const [subjectId, subjectKind] = subjectParameters(subject);
  const result = await client.query<GuestMessageValueRow>(
    `SELECT r.full_name, r.guest2_full_name, e.starts_at, e.payment_instructions,
            NULL::integer AS queue_position
       FROM reservations r
       JOIN events e ON e.id = r.event_id
      WHERE r.id = $1::uuid
        AND $2::text = 'reservation'
     UNION ALL
     SELECT w.full_name, w.guest2_full_name, e.starts_at, e.payment_instructions,
            CASE WHEN w.status = 'WAITING' THEN (
              SELECT count(*)::integer
                FROM waitlist_entries ranked
               WHERE ranked.event_id = w.event_id
                 AND ranked.status = 'WAITING'
                 AND ranked.waitlist_number <= w.waitlist_number
            ) END AS queue_position
       FROM waitlist_entries w
       JOIN events e ON e.id = w.event_id
      WHERE w.id = $1::uuid
        AND $2::text = 'waitlist'`,
    [subjectId, subjectKind],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Guest message subject not found");
  }

  const values: Record<string, string> = {
    nombre: firstName(row.full_name),
    nombres: guestFirstNames(row.full_name, row.guest2_full_name),
    fecha: formatPublicEventDate(row.starts_at),
    pago: row.payment_instructions ?? "",
  };
  if (row.queue_position !== null) {
    values.posicion = String(row.queue_position);
  }
  return values;
}
