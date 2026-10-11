import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../helpers/test-db";

function migrationsBefore(tag: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cl4n-event-delete-migrations-"));
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

describe("migration 0009 event soft deletion", () => {
  it("adds deletion state and makes slugs unique only for live events", async () => {
    const url = testDatabaseUrl();
    const database = `${url.pathname.slice(1)}_event_soft_delete`;
    url.pathname = `/${database}`;
    const previous = migrationsBefore("0009_event_soft_delete");

    await maintenance(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: url.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previous });
      const existing = await pool.query<{ id: string }>(
        `INSERT INTO events (
           slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at
         ) VALUES (
           'slug-reutilizable', 'Anterior', now() + interval '2 days', 10, 2,
           now() + interval '1 hour', now() + interval '1 day'
         ) RETURNING id`,
      );

      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      await expect(
        pool.query(
          `SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'events'
              AND column_name = 'deleted_at'
              AND is_nullable = 'YES'`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        pool.query(
          `SELECT 1
             FROM pg_enum value
             JOIN pg_type type ON type.oid = value.enumtypid
            WHERE type.typname = 'audit_action'
              AND value.enumlabel = 'EVENT_DELETED'`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        pool.query("SELECT 1 FROM pg_constraint WHERE conname = 'events_slug_uq'"),
      ).resolves.toMatchObject({ rowCount: 0 });

      await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [
        existing.rows[0]!.id,
      ]);
      await expect(
        pool.query(
          `INSERT INTO events (
             slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at
           ) VALUES (
             'slug-reutilizable', 'Actual', now() + interval '3 days', 10, 2,
             now() + interval '1 hour', now() + interval '1 day'
           )`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await expect(
        pool.query(
          `INSERT INTO events (
             slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at
           ) VALUES (
             'slug-reutilizable', 'Otro live', now() + interval '4 days', 10, 2,
             now() + interval '1 hour', now() + interval '1 day'
           )`,
        ),
      ).rejects.toMatchObject({ constraint: "events_slug_live_uq" });
      await expect(
        pool.query(
          `INSERT INTO events (
             slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at,
             deleted_at
           ) VALUES (
             'slug-reutilizable', 'Otro eliminado', now() + interval '5 days', 10, 2,
             now() + interval '1 hour', now() + interval '1 day', clock_timestamp()
           )`,
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await pool.end();
      rmSync(previous, { recursive: true, force: true });
      await maintenance(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  }, 15_000);
});
