import { randomBytes, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

export const LOCATION_TEST_STARTS_AT = new Date("2030-11-23T01:30:00.000Z");

// A pool, or a client inside a transaction that a test keeps open on purpose.
export type Queryable = Pick<PoolClient, "query">;

export interface LocationEventOptions {
  confirmed?: boolean;
  name?: string | null;
  address?: string | null;
  notes?: string | null;
  mapsUrl?: string | null;
}

export interface GuestReservationOptions {
  stage?: "IN_REVIEW" | "ON_LIST" | "PAID";
  status?: "CONFIRMED" | "CANCELLED";
  contactId?: string | null;
  fullName?: string;
  guest2FullName?: string | null;
}

export interface LocationMessageRow {
  id: string;
  event_id: string;
  reservation_id: string;
  contact_id: string | null;
  status: string;
  body: string;
  attachment_urls: string[] | null;
  location_revision: number;
  source: string;
  created_by: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
}

let sequence = 0;

function nextSequence(): number {
  sequence += 1;
  return sequence;
}

export async function insertAdminUser(
  db: Queryable,
  displayName = "Admin de prueba",
): Promise<string> {
  const email = `${randomUUID()}@example.com`;
  const result = await db.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, 'hash', $2)
     RETURNING id`,
    [email, displayName],
  );
  return result.rows[0]!.id;
}

export async function insertLocationEvent(
  db: Queryable,
  options: LocationEventOptions = {},
): Promise<string> {
  const fixture = {
    confirmed: true,
    name: "Casa Secreta",
    address: "Calle 1, San Salvador",
    notes: "Toca el timbre",
    mapsUrl: "https://maps.google.com/?q=casa",
    ...options,
  };
  const result = await db.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at,
       location_name, location_address, location_maps_url, location_notes,
       location_status, location_confirmed_at
     ) VALUES (
       $1, 'Ubicación por DM', $2, 50, 2,
       $2::timestamptz - interval '10 days', $2::timestamptz - interval '9 days',
       $3, $4, $5, $6, $7::event_location_status,
       CASE WHEN $7::event_location_status = 'CONFIRMED' THEN now() ELSE NULL END
     ) RETURNING id`,
    [
      `location-dm-${randomUUID()}`,
      LOCATION_TEST_STARTS_AT,
      fixture.name,
      fixture.address,
      fixture.mapsUrl,
      fixture.notes,
      fixture.confirmed ? "CONFIRMED" : "PENDING",
    ],
  );
  return result.rows[0]!.id;
}

export async function insertMessagingContact(
  db: Queryable,
  lastInboundAt: Date | null = new Date(),
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
     VALUES ($1, $2) RETURNING id`,
    [String(5_000_000 + nextSequence()), lastInboundAt],
  );
  return result.rows[0]!.id;
}

// A CONFIRMED reservation also takes its seats, so the event keeps reserved_seats = SUM(party_size).
export async function insertGuestReservation(
  db: Queryable,
  eventId: string,
  options: GuestReservationOptions = {},
): Promise<string> {
  const fixture = {
    stage: "PAID",
    status: "CONFIRMED",
    contactId: null,
    fullName: "Ana López",
    guest2FullName: null,
    ...options,
  };
  const number = nextSequence();
  const partySize = fixture.guest2FullName ? 2 : 1;
  const result = await db.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle, party_size, terms_accepted_at,
       idempotency_key, submitted_at, accepted_at, cancelled_at, stage, on_list_at,
       paid_at, contact_id, contact_linked_by
     ) VALUES (
       $1, $2, $3::reservation_status, $4, $5, $6, $7, $8, now(),
       $9, now(), now(),
       CASE WHEN $3::reservation_status = 'CANCELLED' THEN now() ELSE NULL END,
       $10, CASE WHEN $10 = 'IN_REVIEW' THEN NULL ELSE now() END,
       CASE WHEN $10 = 'PAID' THEN now() ELSE NULL END, $11,
       CASE WHEN $11::uuid IS NULL THEN NULL ELSE 'CODE' END
     ) RETURNING id`,
    [
      eventId,
      number,
      fixture.status,
      fixture.fullName,
      `guest.${number}`,
      fixture.guest2FullName,
      fixture.guest2FullName ? `guest.${number}.b` : null,
      partySize,
      randomUUID(),
      fixture.stage,
      fixture.contactId,
    ],
  );
  if (fixture.status === "CONFIRMED") {
    await db.query(
      `UPDATE events
          SET reserved_seats = reserved_seats + $2,
              last_reservation_number = GREATEST(last_reservation_number, $3)
        WHERE id = $1`,
      [eventId, partySize, number],
    );
  }
  return result.rows[0]!.id;
}

export async function insertEventPhoto(
  db: Queryable,
  input: { eventId: string; adminId: string; uploadedAt: Date },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO event_images (event_id, content_type, byte_size, data, public_token, created_by, created_at)
     VALUES ($1, 'image/png', 1, $2, $3, $4, $5)`,
    [input.eventId, Buffer.from([1]), token, input.adminId, input.uploadedAt],
  );
  return token;
}

export async function listLocationMessages(
  db: Queryable,
  eventId: string,
): Promise<LocationMessageRow[]> {
  const result = await db.query<LocationMessageRow>(
    `SELECT id, event_id, reservation_id, contact_id, status, body, attachment_urls,
            location_revision, source, created_by, attempts, last_error, created_at
       FROM messages
      WHERE event_id = $1 AND kind = 'LOCATION'
      ORDER BY location_revision, created_at, id`,
    [eventId],
  );
  return result.rows;
}

// Hand-built rows for states that the delivery loop would otherwise take real time to reach.
export async function insertLocationMessage(
  db: Queryable,
  input: {
    eventId: string;
    reservationId: string;
    status: string;
    revision?: number;
    contactId?: string | null;
    sentAt?: Date | null;
  },
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO messages (
       contact_id, reservation_id, event_id, direction, kind, source, status, body,
       location_revision, attempts, last_error, sent_at, read_at
     ) VALUES (
       $1, $2, $3, 'OUTBOUND', 'LOCATION', 'SYSTEM', $4, 'Ubicación anterior', $5,
       CASE WHEN $4 = 'FAILED' THEN 3 ELSE 0 END,
       CASE WHEN $4 = 'FAILED' THEN 'META_400_1' ELSE NULL END,
       CASE WHEN $4 IN ('SENT', 'READ', 'SENT_MANUALLY') THEN COALESCE($6::timestamptz, now()) END,
       CASE WHEN $4 = 'READ' THEN now() END
     ) RETURNING id`,
    [
      input.contactId ?? null,
      input.reservationId,
      input.eventId,
      input.status,
      input.revision ?? 0,
      input.sentAt ?? null,
    ],
  );
  return result.rows[0]!.id;
}

// Runs the work in a transaction that holds the event row lock, like every admin transition does.
export async function inEventLock<T>(
  pool: Pool,
  eventId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
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

// Opens the event lock and keeps the transaction open so a test can queue other work behind it.
export async function openEventLock(pool: Pool, eventId: string): Promise<PoolClient> {
  const holder = await pool.connect();
  await holder.query("BEGIN");
  await holder.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [eventId]);
  return holder;
}

export async function waitUntilSomeoneIsBlocked(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'`,
    );
    if (waiting.rows[0]!.count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("No backend became blocked on the event row lock");
}
