import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../helpers/test-db";

async function withMaintenanceClient(work: (client: Client) => Promise<void>): Promise<void> {
  const maintenanceUrl = testDatabaseUrl();
  maintenanceUrl.pathname = "/postgres";
  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

function migrationsWithout(tag: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cl4n-migrations-"));
  cpSync(path.resolve("drizzle"), directory, { recursive: true });
  const journalPath = path.join(directory, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  // Later migrations depend on the removed one, so they are dropped with it.
  const removedFrom = journal.entries.findIndex((entry) => entry.tag === tag);
  for (const entry of journal.entries.slice(removedFrom)) {
    rmSync(path.join(directory, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.slice(0, removedFrom);
  writeFileSync(journalPath, JSON.stringify(journal));
  return directory;
}

async function expectConstraintViolation(
  operation: Promise<unknown>,
  constraint: string,
): Promise<void> {
  let caught: unknown;

  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  expect(caught).toMatchObject({ constraint });
}

describe("migration 0004_waitlist_outbox_password_reset", () => {
  it("preserves existing rows and enforces the waitlist and outbox constraints", async () => {
    const target = testDatabaseUrl();
    const database = `${target.pathname.slice(1)}_waitlist_outbox`;
    target.pathname = `/${database}`;
    const previousMigrations = migrationsWithout("0004_waitlist_outbox_password_reset");

    await withMaintenanceClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: target.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previousMigrations });
      const event = await pool.query<{ id: string }>(
        `INSERT INTO events (
           slug, internal_name, starts_at, capacity, reserved_seats, max_party_size, opens_at, closes_at
         )
         VALUES ('migration-0004', 'Existing event', '2030-01-02T00:00:00Z', 10, 1, 4,
           '2030-01-01T00:00:00Z', '2030-01-01T02:00:00Z')
         RETURNING id`,
      );
      const eventId = event.rows[0]!.id;
      const reservation = await pool.query<{ id: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
           email, email_normalized, party_size, terms_accepted_at, idempotency_key,
           submitted_at, accepted_at
         )
         VALUES ($1, 1, 'CONFIRMED', 'Existing guest', 'existing', '+50370000000',
           'existing@example.com', 'existing@example.com', 1, now(), gen_random_uuid(), now(), now())
         RETURNING id`,
        [eventId],
      );
      const reservationId = reservation.rows[0]!.id;

      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      const preserved = await pool.query(
        `SELECT e.internal_name, e.waitlist_capacity, e.waitlisted_count, e.last_waitlist_number,
                r.full_name
           FROM events e
           JOIN reservations r ON r.event_id = e.id
          WHERE e.id = $1`,
        [eventId],
      );
      expect(preserved.rows).toEqual([
        {
          internal_name: "Existing event",
          waitlist_capacity: 5,
          waitlisted_count: 0,
          last_waitlist_number: 0,
          full_name: "Existing guest",
        },
      ]);

      await expectConstraintViolation(
        pool.query("UPDATE events SET waitlisted_count = waitlist_capacity + 1 WHERE id = $1", [
          eventId,
        ]),
        "events_waitlisted_within_capacity_chk",
      );

      await expectConstraintViolation(
        pool.query("INSERT INTO email_outbox (kind) VALUES ('RESERVATION_CONFIRMED')"),
        "email_outbox_single_subject_chk",
      );

      await expectConstraintViolation(
        pool.query(
          `INSERT INTO waitlist_entries (
             event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
             email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
           )
           VALUES ($1, 1, 'PROMOTED', 'Promoted guest', 'promoted', '+50370000001',
             'promoted@example.com', 'promoted@example.com', 1, now(), gen_random_uuid(), now())`,
          [eventId],
        ),
        "waitlist_entries_promoted_fields_chk",
      );

      const waiting = await pool.query<{ id: string }>(
        `INSERT INTO waitlist_entries (
           event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
           email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
         )
         VALUES ($1, 1, 'WAITING', 'Waiting guest', 'waiting', '+50370000002',
           'waiting@example.com', 'waiting@example.com', 1, now(), gen_random_uuid(), now())
         RETURNING id`,
        [eventId],
      );
      const waitlistEntryId = waiting.rows[0]!.id;

      await expectConstraintViolation(
        pool.query(
          `INSERT INTO email_outbox (kind, reservation_id, waitlist_entry_id)
           VALUES ('RESERVATION_CONFIRMED', $1, $2)`,
          [reservationId, waitlistEntryId],
        ),
        "email_outbox_single_subject_chk",
      );

      await expectConstraintViolation(
        pool.query(
          `INSERT INTO waitlist_entries (
             event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
             email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
           )
           VALUES ($1, 2, 'WAITING', 'Duplicate email', 'duplicate', '+50370000003',
             'waiting@example.com', 'waiting@example.com', 1, now(), gen_random_uuid(), now())`,
          [eventId],
        ),
        "waitlist_entries_one_waiting_per_email_uq",
      );

      await expectConstraintViolation(
        pool.query(
          `INSERT INTO idempotency_records (
             key, scope, request_fingerprint, reservation_id, waitlist_entry_id
           )
           VALUES (gen_random_uuid(), 'reservation_submit', 'fingerprint', $1, $2)`,
          [reservationId, waitlistEntryId],
        ),
        "idempotency_records_single_subject_chk",
      );

      await pool.query(
        "UPDATE waitlist_entries SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
        [waitlistEntryId],
      );
      await expect(
        pool.query(
          `INSERT INTO waitlist_entries (
             event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
             email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
           )
           VALUES ($1, 2, 'WAITING', 'Replacement guest', 'replacement', '+50370000003',
             'waiting@example.com', 'waiting@example.com', 1, now(), gen_random_uuid(), now())`,
          [eventId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await pool.end();
      rmSync(previousMigrations, { recursive: true, force: true });
      await withMaintenanceClient(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  });
});
