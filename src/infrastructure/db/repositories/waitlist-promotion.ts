import type { PoolClient } from "pg";

import { queueReleasedLocationEmail } from "./released-location-email";

interface WaitingEntryRow {
  id: string;
  waitlist_number: number;
  full_name: string;
  instagram_handle: string;
  phone_e164: string;
  email: string;
  email_normalized: string;
  party_size: number;
  notes: string | null;
  allergies: string | null;
  terms_accepted_at: Date;
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
    `SELECT id, waitlist_number, full_name, instagram_handle, phone_e164,
            email, email_normalized, party_size, notes, allergies, terms_accepted_at,
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
        AND (email_normalized = $2 OR phone_e164 = $3)
      LIMIT 1`,
    [eventId, entry.email_normalized, entry.phone_e164],
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
       phone_e164, email, email_normalized, party_size, notes, allergies,
       terms_accepted_at, idempotency_key, submitted_at, accepted_at
     )
     VALUES (
       $1, $2, 'CONFIRMED', $3, $4,
       $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14
     )
     RETURNING id`,
    [
      eventId,
      seats.last_reservation_number,
      entry.full_name,
      entry.instagram_handle,
      entry.phone_e164,
      entry.email,
      entry.email_normalized,
      entry.party_size,
      entry.notes,
      entry.allergies,
      entry.terms_accepted_at,
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
  await client.query(
    `INSERT INTO email_outbox (kind, reservation_id)
     VALUES ('WAITLIST_PROMOTED', $1)`,
    [reservationId],
  );
  await queueReleasedLocationEmail(client, eventId, reservationId);
}

/**
 * Must run inside a transaction that already holds the event row lock.
 * Strict FIFO: stops at the first head entry that does not fit.
 */
export async function promoteWaitlist(client: PoolClient, eventId: string): Promise<number> {
  let promoted = 0;

  for (;;) {
    const entry = await readWaitingHead(client, eventId);
    if (!entry) {
      return promoted;
    }

    if (await hasConfirmedDuplicate(client, eventId, entry)) {
      await cancelDuplicateEntry(client, eventId, entry);
      continue;
    }

    const seats = await takeSeats(client, eventId, entry.party_size);
    if (!seats) {
      return promoted;
    }

    const reservationId = await insertPromotedReservation(client, eventId, entry, seats);
    await markPromoted(client, entry.id, reservationId);
    await recordPromotion(client, eventId, entry, reservationId, seats.last_reservation_number);
    promoted += 1;
  }
}
