import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../helpers/test-db";

function migrationsBefore(tag: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cl4n-location-migrations-"));
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

describe("migration 0006 event location", () => {
  it("applies over 0005 and enforces location and image checks", async () => {
    const url = testDatabaseUrl();
    const database = `${url.pathname.slice(1)}_event_location`;
    url.pathname = `/${database}`;
    const previous = migrationsBefore("0006_brainy_the_liberteens");
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
         ) VALUES ('existing-location-event', 'Existing', now() + interval '2 days', 10, 2,
                   now(), now() + interval '1 day') RETURNING id`,
      );
      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });
      const migrated = await pool.query(
        "SELECT location_status, location_confirmed_at, location_revision FROM events WHERE id = $1",
        [event.rows[0]!.id],
      );
      expect(migrated.rows).toEqual([
        { location_status: "PENDING", location_confirmed_at: null, location_revision: 0 },
      ]);

      await expect(
        pool.query(
          `UPDATE events SET location_status = 'CONFIRMED', location_confirmed_at = now()
            WHERE id = $1`,
          [event.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ constraint: "events_location_confirmation_complete_chk" });
      await expect(
        pool.query("UPDATE events SET location_maps_url = 'http://google.com/maps' WHERE id = $1", [
          event.rows[0]!.id,
        ]),
      ).rejects.toMatchObject({ constraint: "events_location_maps_url_chk" });

      const admin = await pool.query<{ id: string }>(
        `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
         VALUES ('location@example.com', 'location@example.com', 'hash', 'Admin') RETURNING id`,
      );
      await expect(
        pool.query(
          `INSERT INTO event_images (
             event_id, content_type, byte_size, data, public_token, created_by
           ) VALUES ($1, 'image/gif', 1, $2, $3, $4)`,
          [event.rows[0]!.id, Buffer.from([1]), "a".repeat(43), admin.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ constraint: "event_images_content_type_chk" });
    } finally {
      await pool.end();
      rmSync(previous, { recursive: true, force: true });
      await maintenance(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  });
});
