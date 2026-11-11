import type { PoolClient } from "pg";

import { enqueueStatusMessage } from "./status-messages";

// The caller must hold the event row lock before locking its requests.
export async function cancelEventRequests(
  client: PoolClient,
  eventId: string,
  actorAdminId: string,
): Promise<{
  cancelledReservations: number;
  refundsPending: number;
  cancelledEntries: number;
  messageIds: string[];
}> {
  const reservations = await client.query<{
    id: string;
    stage: "IN_REVIEW" | "ON_LIST" | "PAID";
    party_size: number;
  }>(
    `SELECT id, stage, party_size
       FROM reservations
      WHERE event_id = $1 AND status = 'CONFIRMED'
      ORDER BY id
      FOR UPDATE`,
    [eventId],
  );
  let releasedSeats = 0;
  let refundsPending = 0;
  const messageIds: string[] = [];
  for (const reservation of reservations.rows) {
    const refundPending = reservation.stage === "PAID";
    await client.query(
      `UPDATE reservations
          SET status = 'CANCELLED', release_reason = 'CANCELLED',
              refund_status = CASE WHEN stage = 'PAID' THEN 'PENDING' ELSE NULL END,
              cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1`,
      [reservation.id],
    );
    await client.query(
      `INSERT INTO audit_logs (
         actor_type, actor_admin_id, action, entity_type, entity_id, metadata
       )
       VALUES ('ADMIN', $1, 'RESERVATION_CANCELLED', 'RESERVATION', $2, $3::jsonb)`,
      [
        actorAdminId,
        reservation.id,
        JSON.stringify({
          eventId,
          stage: reservation.stage,
          partySize: reservation.party_size,
          refundPending,
          reason: "EVENT_CANCELLED",
        }),
      ],
    );
    messageIds.push(
      await enqueueStatusMessage(client, {
        kind: refundPending ? "CANCELLED_PAID" : "CANCELLED_UNPAID",
        eventId,
        subject: { reservationId: reservation.id },
        actorAdminId,
      }),
    );
    releasedSeats += reservation.party_size;
    if (refundPending) refundsPending += 1;
  }

  const entries = await client.query<{ id: string }>(
    `SELECT id
       FROM waitlist_entries
      WHERE event_id = $1 AND status = 'WAITING'
      ORDER BY waitlist_number
      FOR UPDATE`,
    [eventId],
  );
  for (const entry of entries.rows) {
    await client.query(
      `UPDATE waitlist_entries
          SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [entry.id],
    );
    await client.query(
      `INSERT INTO audit_logs (
         actor_type, actor_admin_id, action, entity_type, entity_id, metadata
       )
       VALUES ('ADMIN', $1, 'WAITLIST_CANCELLED', 'WAITLIST_ENTRY', $2, $3::jsonb)`,
      [actorAdminId, entry.id, JSON.stringify({ eventId, reason: "EVENT_CANCELLED" })],
    );
    messageIds.push(
      await enqueueStatusMessage(client, {
        kind: "CANCELLED_UNPAID",
        eventId,
        subject: { waitlistEntryId: entry.id },
        actorAdminId,
      }),
    );
  }

  await client.query(
    `UPDATE events
        SET reserved_seats = reserved_seats - $2,
            waitlisted_count = waitlisted_count - $3,
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [eventId, releasedSeats, entries.rows.length],
  );
  return {
    cancelledReservations: reservations.rows.length,
    refundsPending,
    cancelledEntries: entries.rows.length,
    messageIds,
  };
}
