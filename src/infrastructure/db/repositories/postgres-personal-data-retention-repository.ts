import type { Pool } from "pg";

import type {
  PersonalDataPurgeBatch,
  PersonalDataRetentionRepository,
  UnattributedPersonalDataRetentionRepository,
} from "@/application/privacy/purge-expired-personal-data";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

const eventMessages = `event_id = $1
  OR reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)
  OR waitlist_entry_id IN (SELECT id FROM waitlist_entries WHERE event_id = $1)`;

const orphanedContact = `c.created_at < now() - interval '90 days'
  AND (c.last_inbound_at IS NULL OR c.last_inbound_at < now() - interval '90 days')
  AND NOT EXISTS (SELECT 1 FROM reservations WHERE contact_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM waitlist_entries WHERE contact_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM request_guests WHERE contact_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM messages WHERE contact_id = c.id)`;

export class PostgresPersonalDataRetentionRepository
  implements PersonalDataRetentionRepository, UnattributedPersonalDataRetentionRepository
{
  constructor(private readonly pool: Pool = applicationPool) {}

  async listDueEventIds(limit: number): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM events
        WHERE starts_at < now() - interval '90 days'
          AND personal_data_purged_at IS NULL
        ORDER BY starts_at, id
        LIMIT $1`,
      [Math.min(limit, 20)],
    );
    return result.rows.map((row) => row.id);
  }

  purgeUnattributedMessagesBatch(): Promise<PersonalDataPurgeBatch> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const selected = await client.query<{ id: string }>(
        `SELECT id FROM messages
          WHERE event_id IS NULL AND reservation_id IS NULL AND waitlist_entry_id IS NULL
            AND received_at < now() - interval '90 days'
          ORDER BY received_at, id
          LIMIT 500
          FOR UPDATE SKIP LOCKED`,
      );
      const ids = selected.rows.map((row) => row.id);
      await client.query(
        `DELETE FROM message_attachments
          WHERE id IN (
            SELECT id FROM message_attachments
             WHERE message_id = ANY($1::uuid[])
             ORDER BY id LIMIT 500
          )`,
        [ids],
      );
      // A message can have ten images, so leave it for the next batch until all are removed.
      const deleted = await client.query(
        `DELETE FROM messages m
          WHERE m.id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM message_attachments WHERE message_id = m.id)`,
        [ids],
      );
      return { deleted: deleted.rowCount ?? 0, hasMore: ids.length > 0 };
    });
  }

  purgeOrphanedContactsBatch(): Promise<PersonalDataPurgeBatch> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const selected = await client.query<{ id: string }>(
        `SELECT c.id FROM messaging_contacts c
          WHERE ${orphanedContact}
          ORDER BY c.created_at, c.id
          LIMIT 500
          FOR UPDATE OF c SKIP LOCKED`,
      );
      // Recheck references with a fresh snapshot after locking the contacts.
      const deleted = await client.query(
        `DELETE FROM messaging_contacts c
          WHERE c.id = ANY($1::uuid[]) AND ${orphanedContact}`,
        [selected.rows.map((row) => row.id)],
      );
      return { deleted: deleted.rowCount ?? 0, hasMore: selected.rows.length > 0 };
    });
  }

  purgeEvent(eventId: string): Promise<boolean> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const event = await client.query(
        `SELECT id FROM events
          WHERE id = $1 AND personal_data_purged_at IS NULL
            AND starts_at < now() - interval '90 days'
          FOR UPDATE`,
        [eventId],
      );
      if (event.rowCount === 0) return false;

      // Keep the affected contact ids before removing their event links.
      const contacts = await client.query<{ contact_id: string | null }>(
        `SELECT contact_id FROM reservations WHERE event_id = $1
         UNION SELECT contact_id FROM waitlist_entries WHERE event_id = $1
         UNION SELECT g.contact_id FROM request_guests g
          WHERE g.reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)
             OR g.waitlist_entry_id IN (SELECT id FROM waitlist_entries WHERE event_id = $1)
         UNION SELECT contact_id FROM messages WHERE ${eventMessages}`,
        [eventId],
      );
      await client.query(
        `DELETE FROM message_attachments
          WHERE message_id IN (SELECT id FROM messages WHERE ${eventMessages})`,
        [eventId],
      );
      await client.query(`DELETE FROM messages WHERE ${eventMessages}`, [eventId]);
      await client.query(
        `DELETE FROM idempotency_records
          WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)
             OR waitlist_entry_id IN (SELECT id FROM waitlist_entries WHERE event_id = $1)
             OR key IN (SELECT idempotency_key FROM reservations WHERE event_id = $1
                        UNION SELECT idempotency_key FROM waitlist_entries WHERE event_id = $1)`,
        [eventId],
      );
      await client.query(
        `UPDATE reservations
            SET full_name = 'eliminado',
                instagram_handle = 'eliminado_' || substr(id::text, 1, 8),
                phone_e164 = NULL, email = NULL, email_normalized = NULL,
                notes = NULL, allergies = NULL, payment_note = NULL, link_code = NULL,
                contact_id = NULL, contact_linked_by = NULL, release_reason = NULL
          WHERE event_id = $1`,
        [eventId],
      );
      await client.query(
        `UPDATE waitlist_entries
            SET full_name = 'eliminado',
                instagram_handle = 'eliminado_' || substr(id::text, 1, 8),
                phone_e164 = NULL, email = NULL, email_normalized = NULL,
                notes = NULL, allergies = NULL, link_code = NULL,
                contact_id = NULL, contact_linked_by = NULL
          WHERE event_id = $1`,
        [eventId],
      );
      await client.query(
        `DELETE FROM request_guests
          WHERE reservation_id IN (SELECT id FROM reservations WHERE event_id = $1)
             OR waitlist_entry_id IN (SELECT id FROM waitlist_entries WHERE event_id = $1)`,
        [eventId],
      );
      await client.query(
        `DELETE FROM messaging_contacts c
          WHERE c.id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM reservations WHERE contact_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM waitlist_entries WHERE contact_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM request_guests WHERE contact_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM messages WHERE contact_id = c.id)`,
        [contacts.rows.map((row) => row.contact_id).filter((id) => id !== null)],
      );
      await client.query("UPDATE events SET personal_data_purged_at = now() WHERE id = $1", [
        eventId,
      ]);
      return true;
    });
  }
}
