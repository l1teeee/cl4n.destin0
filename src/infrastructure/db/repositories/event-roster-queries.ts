import type { Pool, QueryResultRow } from "pg";

import type {
  EventRosterCounts,
  EventRosterRow,
  RosterEmailStatus,
  RosterStatus,
  RosterView,
} from "@/application/events/types";

interface RosterRecord extends QueryResultRow {
  kind: EventRosterRow["kind"];
  id: string;
  status: RosterStatus;
  reservation_number: number | null;
  queue_position: number | null;
  full_name: string;
  instagram_handle: string;
  phone_e164: string;
  email: string;
  party_size: number;
  submitted_at: Date;
  email_status: RosterEmailStatus | null;
  email_sent_at: Date | null;
  email_last_error: string | null;
}

const statusesByView: Record<RosterView, RosterStatus[]> = {
  confirmadas: ["CONFIRMED"],
  "en-cola": ["WAITING"],
  rechazadas: ["REJECTED"],
  canceladas: ["CANCELLED"],
  todas: ["CONFIRMED", "WAITING", "REJECTED", "CANCELLED", "PROMOTED"],
};

const orderByView: Record<RosterView, string> = {
  confirmadas: "reservation_number, id",
  "en-cola": "queue_position, id",
  rechazadas: "submitted_at, id",
  canceladas: "submitted_at, id",
  todas: "submitted_at, id",
};

// WHY: the queue position is the live rank among WAITING entries, so the window runs over every
// entry of the event before any view filter is applied. SUBMITTED and EXPIRED reservations are
// transient states that never belong in a guest list.
const rosterCte = `
  roster AS (
    SELECT 'RESERVATION' AS kind,
           r.id,
           NULL::uuid AS promoted_reservation_id,
           CASE r.status
             WHEN 'CONFIRMED' THEN 'CONFIRMED'
             WHEN 'FULL_REJECTED' THEN 'REJECTED'
             ELSE 'CANCELLED'
           END AS status,
           r.reservation_number,
           NULL::int AS queue_position,
           r.full_name,
           r.instagram_handle,
           r.phone_e164,
           r.email,
           r.party_size,
           r.submitted_at
      FROM reservations r
     WHERE r.event_id = $1
       AND r.status IN ('CONFIRMED', 'FULL_REJECTED', 'CANCELLED')
    UNION ALL
    SELECT 'WAITLIST_ENTRY',
           w.id,
           w.promoted_reservation_id,
           w.status,
           NULL::int,
           CASE WHEN w.status = 'WAITING'
             THEN (ROW_NUMBER() OVER (PARTITION BY w.status ORDER BY w.waitlist_number))::int
           END,
           w.full_name,
           w.instagram_handle,
           w.phone_e164,
           w.email,
           w.party_size,
           w.submitted_at
      FROM waitlist_entries w
     WHERE w.event_id = $1
  )`;

function toRosterRow(record: RosterRecord): EventRosterRow {
  return {
    kind: record.kind,
    id: record.id,
    status: record.status,
    reservationNumber: record.reservation_number,
    queuePosition: record.queue_position,
    fullName: record.full_name,
    instagram: record.instagram_handle,
    phone: record.phone_e164,
    email: record.email,
    partySize: record.party_size,
    submittedAt: record.submitted_at,
    emailStatus: record.email_status,
    emailSentAt: record.email_sent_at,
    emailLastError: record.email_last_error,
  };
}

export async function queryEventRoster(
  pool: Pool,
  eventId: string,
  view: RosterView,
): Promise<EventRosterRow[]> {
  const result = await pool.query<RosterRecord>(
    `WITH ${rosterCte}
     SELECT roster.*,
            mail.status AS email_status,
            mail.sent_at AS email_sent_at,
            mail.last_error AS email_last_error
       FROM roster
       LEFT JOIN LATERAL (
         SELECT o.status, o.sent_at, o.last_error
           FROM email_outbox o
          WHERE (roster.kind = 'RESERVATION' AND o.reservation_id = roster.id)
             OR (roster.kind = 'WAITLIST_ENTRY' AND o.waitlist_entry_id = roster.id)
             OR (roster.status = 'PROMOTED' AND o.reservation_id = roster.promoted_reservation_id)
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT 1
       ) mail ON true
      WHERE roster.status = ANY($2::text[])
      ORDER BY ${orderByView[view]}`,
    [eventId, statusesByView[view]],
  );
  return result.rows.map(toRosterRow);
}

export async function queryEventRosterCounts(
  pool: Pool,
  eventId: string,
): Promise<EventRosterCounts> {
  const result = await pool.query<{ status: RosterStatus; total: number }>(
    `WITH ${rosterCte}
     SELECT status, COUNT(*)::int AS total
       FROM roster
      GROUP BY status`,
    [eventId],
  );
  const totals = new Map(result.rows.map((row) => [row.status, row.total]));
  const countOf = (status: RosterStatus) => totals.get(status) ?? 0;
  return {
    confirmadas: countOf("CONFIRMED"),
    "en-cola": countOf("WAITING"),
    rechazadas: countOf("REJECTED"),
    canceladas: countOf("CANCELLED"),
    todas: result.rows.reduce((sum, row) => sum + row.total, 0),
  };
}
