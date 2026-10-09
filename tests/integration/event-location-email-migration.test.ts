import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../helpers/test-db";

function migrationsBefore(tag: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cl4n-location-email-migrations-"));
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

describe("migration 0007 event location email", () => {
  it("applies over 0006 and preserves other per-kind uniqueness", async () => {
    const url = testDatabaseUrl();
    const database = `${url.pathname.slice(1)}_location_email`;
    url.pathname = `/${database}`;
    const previous = migrationsBefore("0007_event_location_email");
    await maintenance(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: url.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previous });
      const event = await pool.query<{ id: string }>(
        `INSERT INTO events (
           slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at
         ) VALUES ('migration-0007', 'Existing', now() + interval '2 days', 10, 2,
                   now(), now() + interval '1 day') RETURNING id`,
      );
      const reservation = await pool.query<{ id: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
           email, email_normalized, party_size, terms_accepted_at, idempotency_key,
           submitted_at, accepted_at
         ) VALUES ($1, 1, 'CONFIRMED', 'Guest', 'guest', '+50370000000',
                   'guest@example.com', 'guest@example.com', 1, now(), gen_random_uuid(),
                   now(), now()) RETURNING id`,
        [event.rows[0]!.id],
      );
      const reservationId = reservation.rows[0]!.id;
      await pool.query(
        "INSERT INTO email_outbox (kind, reservation_id) VALUES ('RESERVATION_CONFIRMED', $1)",
        [reservationId],
      );

      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      await expect(
        pool.query(
          "INSERT INTO email_outbox (kind, reservation_id) VALUES ('RESERVATION_CONFIRMED', $1)",
          [reservationId],
        ),
      ).rejects.toMatchObject({ constraint: "email_outbox_reservation_kind_uq" });
      await expect(
        pool.query(
          `INSERT INTO email_outbox (kind, reservation_id, location_revision)
           VALUES ('EVENT_LOCATION', $1, 0), ('EVENT_LOCATION', $1, 1)`,
          [reservationId],
        ),
      ).resolves.toMatchObject({ rowCount: 2 });
      await expect(
        pool.query(
          `INSERT INTO email_outbox (kind, reservation_id, location_revision)
           VALUES ('EVENT_LOCATION', $1, 1)`,
          [reservationId],
        ),
      ).rejects.toMatchObject({ constraint: "email_outbox_location_revision_uq" });
      await expect(
        pool.query(
          "INSERT INTO email_outbox (kind, reservation_id) VALUES ('EVENT_LOCATION', $1)",
          [reservationId],
        ),
      ).rejects.toMatchObject({ constraint: "email_outbox_location_revision_chk" });
      await expect(
        pool.query(
          `INSERT INTO email_outbox (kind, reservation_id, location_revision)
           VALUES ('RESERVATION_CANCELLED', $1, 2)`,
          [reservationId],
        ),
      ).rejects.toMatchObject({ constraint: "email_outbox_location_revision_chk" });
    } finally {
      await pool.end();
      rmSync(previous, { recursive: true, force: true });
      await maintenance(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  }, 15_000);

  it("keeps journal timestamps strictly increasing", () => {
    const journal = JSON.parse(
      readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8"),
    ) as {
      entries: { when: number }[];
    };
    journal.entries.slice(1).forEach((entry, index) => {
      expect(entry.when).toBeGreaterThan(journal.entries[index]!.when);
    });
  });

  it("applies 0006 and 0007 together over a database at 0005", async () => {
    const url = testDatabaseUrl();
    const database = `${url.pathname.slice(1)}_location_email_0005`;
    url.pathname = `/${database}`;
    const previous = migrationsBefore("0006_brainy_the_liberteens");
    await maintenance(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: url.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previous });
      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      const columns = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'email_outbox' AND column_name = 'location_revision'`,
      );
      expect(columns.rowCount).toBe(1);
      const eventColumns = await pool.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'events' AND column_name = 'location_revision'`,
      );
      expect(eventColumns.rowCount).toBe(1);
      const applied = await pool.query(
        "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
      );
      expect(applied.rows[0]!.count).toBe(8);
    } finally {
      await pool.end();
      await maintenance(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  }, 15_000);
});
