import type { Pool, PoolClient } from "pg";

import type {
  GuestErasureRepository,
  GuestErasureResult,
  GuestErasureSubject,
} from "@/application/guests/guest-erasure";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

interface LockedRequest {
  id: string;
  full_name: string;
  active: boolean;
  promoted_reservation_id?: string | null;
}

interface AffectedRequests {
  reservations: LockedRequest[];
  entries: LockedRequest[];
}

async function lockReservations(
  client: PoolClient,
  condition: string,
  value: string,
): Promise<LockedRequest[]> {
  const result = await client.query<LockedRequest>(
    `SELECT r.id, r.full_name,
            (r.status = 'CONFIRMED' AND e.starts_at > clock_timestamp()) AS active
       FROM reservations r
       JOIN events e ON e.id = r.event_id
      WHERE ${condition}
      ORDER BY r.id
      FOR UPDATE OF r`,
    [value],
  );
  return result.rows;
}

async function lockEntries(
  client: PoolClient,
  condition: string,
  value: string,
): Promise<LockedRequest[]> {
  const result = await client.query<LockedRequest>(
    `SELECT w.id, w.full_name, w.promoted_reservation_id,
            (w.status = 'WAITING' AND e.starts_at > clock_timestamp()) AS active
       FROM waitlist_entries w
       JOIN events e ON e.id = w.event_id
      WHERE ${condition}
      ORDER BY w.id
      FOR UPDATE OF w`,
    [value],
  );
  return result.rows;
}

// A reservation promoted from a queue entry and that entry hold the same person, so they go together.
async function lockAffected(
  client: PoolClient,
  subject: GuestErasureSubject,
): Promise<AffectedRequests | "NOT_FOUND" | "ALREADY_ERASED"> {
  if ("reservationId" in subject) {
    const reservations = await lockReservations(client, "r.id = $1", subject.reservationId);
    if (reservations.length === 0) return "NOT_FOUND";
    if (reservations[0]!.full_name === "eliminado") return "ALREADY_ERASED";
    const entries = await lockEntries(
      client,
      "w.promoted_reservation_id = $1",
      subject.reservationId,
    );
    return { reservations, entries };
  }
  const entries = await lockEntries(client, "w.id = $1", subject.waitlistEntryId);
  if (entries.length === 0) return "NOT_FOUND";
  if (entries[0]!.full_name === "eliminado") return "ALREADY_ERASED";
  const promotedReservationId = entries[0]!.promoted_reservation_id;
  const reservations = promotedReservationId
    ? await lockReservations(client, "r.id = $1", promotedReservationId)
    : [];
  return { reservations, entries };
}

async function collectContactIds(
  client: PoolClient,
  reservationIds: string[],
  entryIds: string[],
): Promise<string[]> {
  const result = await client.query<{ contact_id: string | null }>(
    `SELECT contact_id FROM reservations WHERE id = ANY($1::uuid[])
     UNION SELECT guest2_contact_id FROM reservations WHERE id = ANY($1::uuid[])
     UNION SELECT contact_id FROM waitlist_entries WHERE id = ANY($2::uuid[])
     UNION SELECT contact_id FROM request_guests
            WHERE reservation_id = ANY($1::uuid[]) OR waitlist_entry_id = ANY($2::uuid[])`,
    [reservationIds, entryIds],
  );
  const ids: string[] = [];
  for (const row of result.rows) {
    if (row.contact_id !== null) ids.push(row.contact_id);
  }
  return ids;
}

async function hasLiveLease(
  client: PoolClient,
  reservationIds: string[],
  entryIds: string[],
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM messages
      WHERE (reservation_id = ANY($1::uuid[]) OR waitlist_entry_id = ANY($2::uuid[]))
        AND status = 'QUEUED' AND locked_until > clock_timestamp()
      LIMIT 1`,
    [reservationIds, entryIds],
  );
  return (result.rowCount ?? 0) > 0;
}

async function deleteMessages(
  client: PoolClient,
  reservationIds: string[],
  entryIds: string[],
): Promise<void> {
  const ownMessages = "reservation_id = ANY($1::uuid[]) OR waitlist_entry_id = ANY($2::uuid[])";
  await client.query(
    `DELETE FROM message_attachments
      WHERE message_id IN (SELECT id FROM messages WHERE ${ownMessages})`,
    [reservationIds, entryIds],
  );
  await client.query(`DELETE FROM messages WHERE ${ownMessages}`, [reservationIds, entryIds]);
}

async function deleteGuestRowsAndIdempotency(
  client: PoolClient,
  reservationIds: string[],
  entryIds: string[],
): Promise<void> {
  await client.query(
    `DELETE FROM request_guests
      WHERE reservation_id = ANY($1::uuid[]) OR waitlist_entry_id = ANY($2::uuid[])`,
    [reservationIds, entryIds],
  );
  await client.query(
    `DELETE FROM idempotency_records
      WHERE reservation_id = ANY($1::uuid[])
         OR waitlist_entry_id = ANY($2::uuid[])
         OR key IN (SELECT idempotency_key FROM reservations WHERE id = ANY($1::uuid[])
                    UNION SELECT idempotency_key FROM waitlist_entries WHERE id = ANY($2::uuid[]))`,
    [reservationIds, entryIds],
  );
}

async function anonymize(
  client: PoolClient,
  reservationIds: string[],
  entryIds: string[],
): Promise<void> {
  await client.query(
    `UPDATE reservations
        SET full_name = 'eliminado',
            instagram_handle = 'eliminado_' || substr(id::text, 1, 8),
            guest2_full_name = NULL, guest2_instagram_handle = NULL, guest2_contact_id = NULL,
            phone_e164 = NULL, email = NULL, email_normalized = NULL,
            notes = NULL, allergies = NULL, payment_note = NULL, link_code = NULL,
            contact_id = NULL, contact_linked_by = NULL, updated_at = clock_timestamp()
      WHERE id = ANY($1::uuid[])`,
    [reservationIds],
  );
  await client.query(
    `UPDATE waitlist_entries
        SET full_name = 'eliminado',
            instagram_handle = 'eliminado_' || substr(id::text, 1, 8),
            guest2_full_name = NULL, guest2_instagram_handle = NULL,
            phone_e164 = NULL, email = NULL, email_normalized = NULL,
            notes = NULL, allergies = NULL, link_code = NULL,
            contact_id = NULL, contact_linked_by = NULL, updated_at = clock_timestamp()
      WHERE id = ANY($1::uuid[])`,
    [entryIds],
  );
}

// A contact still linked to another request keeps its conversation.
async function deleteUnreferencedContacts(client: PoolClient, contactIds: string[]): Promise<void> {
  await client.query(
    `DELETE FROM messaging_contacts c
      WHERE c.id = ANY($1::uuid[])
        AND NOT EXISTS (SELECT 1 FROM reservations WHERE contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM reservations WHERE guest2_contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM waitlist_entries WHERE contact_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM request_guests WHERE contact_id = c.id)`,
    [contactIds],
  );
}

async function insertAudit(
  client: PoolClient,
  adminId: string,
  action: "RESERVATION_UPDATED" | "WAITLIST_UPDATED",
  entityType: "RESERVATION" | "WAITLIST_ENTRY",
  entityId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, actor_admin_id, action, entity_type, entity_id, metadata
     )
     VALUES ('ADMIN', $1, $2, $3, $4, $5::jsonb)`,
    [adminId, action, entityType, entityId, JSON.stringify({ personalDataErased: true })],
  );
}

export class PostgresGuestErasureRepository implements GuestErasureRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  erase(subject: GuestErasureSubject, adminId: string): Promise<GuestErasureResult> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const locked = await lockAffected(client, subject);
      if (typeof locked === "string") return locked;
      const { reservations, entries } = locked;
      if ([...reservations, ...entries].some((request) => request.active)) return "ACTIVE";

      const reservationIds = reservations.map((request) => request.id);
      const entryIds = entries.map((request) => request.id);
      const contactIds = await collectContactIds(client, reservationIds, entryIds);
      if (await hasLiveLease(client, reservationIds, entryIds)) return "LIVE_LEASE";

      await deleteMessages(client, reservationIds, entryIds);
      await deleteGuestRowsAndIdempotency(client, reservationIds, entryIds);
      await anonymize(client, reservationIds, entryIds);
      await deleteUnreferencedContacts(client, contactIds);
      for (const id of reservationIds) {
        await insertAudit(client, adminId, "RESERVATION_UPDATED", "RESERVATION", id);
      }
      for (const id of entryIds) {
        await insertAudit(client, adminId, "WAITLIST_UPDATED", "WAITLIST_ENTRY", id);
      }
      return "ERASED";
    });
  }
}

export const postgresGuestErasureRepository = new PostgresGuestErasureRepository();
