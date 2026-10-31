import type { PoolClient } from "pg";

import { enqueueGuestMessage, loadGuestMessageValues, renderGuestMessage } from "./guest-messages";

interface WaitingEntryRow {
  id: string;
  waitlist_number: number;
  full_name: string;
  instagram_handle: string;
  guest2_full_name: string | null;
  guest2_instagram_handle: string | null;
  phone_e164: string | null;
  email: string | null;
  email_normalized: string | null;
  party_size: number;
  notes: string | null;
  allergies: string | null;
  terms_accepted_at: Date | null;
  link_code: string | null;
  contact_id: string | null;
  source: "PUBLIC" | "ADMIN";
  created_by: string | null;
  idempotency_key: string;
  submitted_at: Date;
}

interface PromotedSeatRow {
  last_reservation_number: number;
  accepted_at: Date;
}

async function readWaitingHead(
  client: PoolClient,
  eventId: string,
): Promise<WaitingEntryRow | null> {
  const result = await client.query<WaitingEntryRow>(
    `SELECT id, waitlist_number, full_name, instagram_handle,
            guest2_full_name, guest2_instagram_handle,
            phone_e164, email, email_normalized, party_size, notes, allergies,
            terms_accepted_at, link_code, contact_id, source, created_by,
            idempotency_key, submitted_at
       FROM waitlist_entries
      WHERE event_id = $1
        AND status = 'WAITING'
      ORDER BY waitlist_number
      LIMIT 1
      FOR UPDATE`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

async function hasConfirmedDuplicate(
  client: PoolClient,
  eventId: string,
  entry: WaitingEntryRow,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM reservations
      WHERE event_id = $1
        AND status = 'CONFIRMED'
        AND (
          instagram_handle IN ($2, $3)
          OR guest2_instagram_handle IN ($2, $3)
        )
      LIMIT 1`,
    [eventId, entry.instagram_handle, entry.guest2_instagram_handle],
  );
  return (result.rowCount ?? 0) > 0;
}

async function cancelDuplicateEntry(
  client: PoolClient,
  eventId: string,
  entry: WaitingEntryRow,
): Promise<void> {
  await client.query(
    `UPDATE waitlist_entries
        SET status = 'CANCELLED',
            cancelled_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [entry.id],
  );
  await client.query(
    `UPDATE events
        SET waitlisted_count = waitlisted_count - 1,
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [eventId],
  );
  await client.query(
    `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, metadata)
     VALUES ('SYSTEM', 'WAITLIST_CANCELLED', 'WAITLIST_ENTRY', $1, $2::jsonb)`,
    [entry.id, JSON.stringify({ eventId, reason: "DUPLICATE" })],
  );
}

async function takeSeats(
  client: PoolClient,
  eventId: string,
  partySize: number,
): Promise<PromotedSeatRow | null> {
  const result = await client.query<PromotedSeatRow>(
    `UPDATE events
        SET reserved_seats = reserved_seats + $2,
            waitlisted_count = waitlisted_count - 1,
            last_reservation_number = last_reservation_number + 1,
            updated_at = clock_timestamp()
      WHERE id = $1
        AND status IN ('SCHEDULED', 'CLOSED')
        AND starts_at > clock_timestamp()
        AND reserved_seats + $2 <= capacity
      RETURNING last_reservation_number, clock_timestamp() AS accepted_at`,
    [eventId, partySize],
  );
  return result.rows[0] ?? null;
}

async function insertPromotedReservation(
  client: PoolClient,
  eventId: string,
  entry: WaitingEntryRow,
  seats: PromotedSeatRow,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle,
       phone_e164, email, email_normalized, party_size, notes, allergies,
       terms_accepted_at, link_code, contact_id, source, created_by,
       idempotency_key, submitted_at, accepted_at
     )
     VALUES (
       $1, $2, 'CONFIRMED', $3, $4,
       $5, $6,
       $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17,
       $18, $19, $20
     )
     RETURNING id`,
    [
      eventId,
      seats.last_reservation_number,
      entry.full_name,
      entry.instagram_handle,
      entry.guest2_full_name,
      entry.guest2_instagram_handle,
      entry.phone_e164,
      entry.email,
      entry.email_normalized,
      entry.party_size,
      entry.notes,
      entry.allergies,
      entry.terms_accepted_at,
      entry.link_code,
      entry.contact_id,
      entry.source,
      entry.created_by,
      entry.idempotency_key,
      entry.submitted_at,
      seats.accepted_at,
    ],
  );
  return result.rows[0]!.id;
}

async function markPromoted(
  client: PoolClient,
  entryId: string,
  reservationId: string,
): Promise<void> {
  await client.query(
    `UPDATE waitlist_entries
        SET status = 'PROMOTED',
            promoted_reservation_id = $2,
            promoted_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [entryId, reservationId],
  );
}

async function recordPromotion(
  client: PoolClient,
  eventId: string,
  entry: WaitingEntryRow,
  reservationId: string,
  reservationNumber: number,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, metadata)
     VALUES ('SYSTEM', 'WAITLIST_PROMOTED', 'RESERVATION', $1, $2::jsonb)`,
    [
      reservationId,
      JSON.stringify({
        eventId,
        waitlistEntryId: entry.id,
        reservationNumber,
        partySize: entry.party_size,
      }),
    ],
  );
  const subject = { reservationId };
  const values = await loadGuestMessageValues(client, subject);
  const body = await renderGuestMessage(client, "PROMOTED", values);
  await enqueueGuestMessage(client, {
    kind: "PROMOTED",
    subject,
    eventId,
    body,
    source: "SYSTEM",
  });
}

/**
 * Must run inside a transaction that already holds the event row lock.
 * Strict FIFO: stops at the first head entry that does not fit.
 */
export async function promoteWaitlist(client: PoolClient, eventId: string): Promise<string[]> {
  const promotedEntryIds: string[] = [];

  for (;;) {
    const entry = await readWaitingHead(client, eventId);
    if (!entry) {
      return promotedEntryIds;
    }

    if (await hasConfirmedDuplicate(client, eventId, entry)) {
      await cancelDuplicateEntry(client, eventId, entry);
      continue;
    }

    const seats = await takeSeats(client, eventId, entry.party_size);
    if (!seats) {
      return promotedEntryIds;
    }

    const reservationId = await insertPromotedReservation(client, eventId, entry, seats);
    await markPromoted(client, entry.id, reservationId);
    await recordPromotion(client, eventId, entry, reservationId, seats.last_reservation_number);
    promotedEntryIds.push(entry.id);
  }
}
