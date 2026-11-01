import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../helpers/test-db";

function migrationsBefore(tag: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cl4n-messaging-hardening-"));
  cpSync(path.resolve("drizzle"), directory, { recursive: true });
  const journalPath = path.join(directory, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const target = journal.entries.find((entry) => entry.tag === tag);
  if (!target) throw new Error(`Migration ${tag} not found`);

  for (const entry of journal.entries.filter((entry) => entry.idx >= target.idx)) {
    rmSync(path.join(directory, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter((entry) => entry.idx < target.idx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return directory;
}

async function maintenance(work: (client: Client) => Promise<void>): Promise<void> {
  const url = testDatabaseUrl();
  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

describe("migration 0014 messaging hardening", () => {
  it("backfills delivery and contact provenance fields and enforces their checks", async () => {
    const url = testDatabaseUrl();
    const database = `${url.pathname.slice(1)}_messaging_hardening`;
    url.pathname = `/${database}`;
    const previous = migrationsBefore("0014_messaging_hardening");

    await maintenance(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: url.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previous });
      const contact = await pool.query<{ id: string }>(
        `INSERT INTO messaging_contacts (instagram_scoped_id)
         VALUES ('123456789')
         RETURNING id`,
      );
      const event = await pool.query<{ id: string }>(
        `INSERT INTO events (
           slug, internal_name, starts_at, capacity, reserved_seats, max_party_size,
           opens_at, closes_at, waitlisted_count
         ) VALUES (
           'migration-0014', 'Migration 0014', now() + interval '2 days', 10, 1, 2,
           now() - interval '1 day', now() + interval '1 day', 1
         ) RETURNING id`,
      );
      const contactId = contact.rows[0]!.id;
      const eventId = event.rows[0]!.id;
      const createdAt = new Date("2026-10-31T12:00:00.000Z");

      const reservation = await pool.query<{ id: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, stage, full_name, instagram_handle,
           phone_e164, email, email_normalized, party_size, terms_accepted_at,
           idempotency_key, submitted_at, accepted_at, on_list_at, paid_at, contact_id
         ) VALUES (
           $1, 1, 'CONFIRMED', 'PAID', 'Linked Guest', 'linked.guest', '+50370000001',
           'linked@example.com', 'linked@example.com', 1, now(), $2, now(), now(), now(), now(), $3
         ) RETURNING id`,
        [eventId, randomUUID(), contactId],
      );
      const waitlist = await pool.query<{ id: string }>(
        `INSERT INTO waitlist_entries (
           event_id, waitlist_number, status, full_name, instagram_handle,
           phone_e164, email, email_normalized, party_size, terms_accepted_at,
           idempotency_key, submitted_at, contact_id
         ) VALUES (
           $1, 1, 'WAITING', 'Linked Waitlist', 'linked.waitlist', '+50370000002',
           'waitlist@example.com', 'waitlist@example.com', 1, now(), $2, now(), $3
         ) RETURNING id`,
        [eventId, randomUUID(), contactId],
      );
      const message = await pool.query<{ id: string }>(
        `INSERT INTO messages (direction, kind, source, status, body, created_at)
         VALUES ('OUTBOUND', 'FREE_TEXT', 'SYSTEM', 'WAITING_CONTACT', 'legacy', $1)
         RETURNING id`,
        [createdAt],
      );

      await migrate(drizzle(pool), {
        migrationsFolder: path.resolve("drizzle"),
      });

      const migratedMessage = await pool.query<{
        external_part_ids: string[] | null;
        parts_sent: number;
        claims_without_progress: number;
        received_at: Date;
      }>(
        `SELECT parts_sent, external_part_ids, claims_without_progress, received_at
           FROM messages
          WHERE id = $1`,
        [message.rows[0]!.id],
      );
      expect(migratedMessage.rows[0]).toMatchObject({
        external_part_ids: null,
        parts_sent: 0,
        claims_without_progress: 0,
      });
      expect(migratedMessage.rows[0]!.received_at.toISOString()).toBe(createdAt.toISOString());

      const linked = await pool.query<{ contact_linked_by: string }>(
        `SELECT contact_linked_by FROM reservations WHERE id = $1
         UNION ALL
         SELECT contact_linked_by FROM waitlist_entries WHERE id = $2`,
        [reservation.rows[0]!.id, waitlist.rows[0]!.id],
      );
      expect(linked.rows).toEqual([{ contact_linked_by: "CODE" }, { contact_linked_by: "CODE" }]);

      const auditValues = await pool.query<{ enumlabel: string }>(
        `SELECT enumlabel
           FROM pg_enum
           JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
          WHERE pg_type.typname = 'audit_action'`,
      );
      expect(auditValues.rows.map((row) => row.enumlabel)).toContain("MESSAGING_CONTACT_UNLINKED");

      await expect(
        pool.query("UPDATE messages SET parts_sent = -1 WHERE id = $1", [message.rows[0]!.id]),
      ).rejects.toMatchObject({ constraint: "messages_parts_sent_chk" });
      await expect(
        pool.query("UPDATE messages SET claims_without_progress = -1 WHERE id = $1", [
          message.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({ constraint: "messages_claims_without_progress_chk" });
      await expect(
        pool.query("UPDATE messages SET external_part_ids = ARRAY[]::text[] WHERE id = $1", [
          message.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({ constraint: "messages_external_part_ids_chk" });
      await expect(
        pool.query("UPDATE reservations SET contact_linked_by = 'OTHER' WHERE id = $1", [
          reservation.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({
        constraint: "reservations_contact_linked_by_chk",
      });
      await expect(
        pool.query("UPDATE waitlist_entries SET contact_id = NULL WHERE id = $1", [
          waitlist.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({
        constraint: "waitlist_entries_contact_link_pair_chk",
      });

      await pool.query("DELETE FROM messaging_contacts WHERE id = $1", [contactId]);
      const deletedContactLinks = await pool.query<{
        contact_id: string | null;
        contact_linked_by: string | null;
      }>(
        `SELECT contact_id, contact_linked_by FROM reservations WHERE id = $1
         UNION ALL
         SELECT contact_id, contact_linked_by FROM waitlist_entries WHERE id = $2`,
        [reservation.rows[0]!.id, waitlist.rows[0]!.id],
      );
      expect(deletedContactLinks.rows).toEqual([
        { contact_id: null, contact_linked_by: null },
        { contact_id: null, contact_linked_by: null },
      ]);
    } finally {
      await pool.end();
      rmSync(previous, { recursive: true, force: true });
      await maintenance(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  }, 20_000);
});
