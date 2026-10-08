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
  rmSync(path.join(directory, `${tag}.sql`));
  const journalPath = path.join(directory, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.tag !== tag);
  writeFileSync(journalPath, JSON.stringify(journal));
  return directory;
}

describe("migration 0003_admin_user_deletion", () => {
  it("keeps existing admins valid and replaces the old email constraint", async () => {
    const target = testDatabaseUrl();
    const database = `${target.pathname.slice(1)}_deletion`;
    target.pathname = `/${database}`;
    const previousMigrations = migrationsWithout("0003_admin_user_deletion");

    await withMaintenanceClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: target.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previousMigrations });
      await pool.query(
        `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
         VALUES ('previo@example.com', 'previo@example.com', 'hash', 'Previo', 'SUPER_ADMIN')`,
      );

      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      const existing = await pool.query(
        "SELECT email_normalized, is_active, deleted_at FROM admin_users",
      );
      expect(existing.rows).toEqual([
        { email_normalized: "previo@example.com", is_active: true, deleted_at: null },
      ]);

      const oldConstraint = await pool.query(
        "SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_email_normalized_uq'",
      );
      expect(oldConstraint.rowCount).toBe(0);
      const liveIndex = await pool.query(
        "SELECT 1 FROM pg_indexes WHERE indexname = 'admin_users_email_normalized_live_uq'",
      );
      expect(liveIndex.rowCount).toBe(1);

      await pool.query(
        `UPDATE admin_users
            SET is_active = false, deleted_at = clock_timestamp()
          WHERE email_normalized = 'previo@example.com'`,
      );
      await expect(
        pool.query(
          `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
           VALUES ('previo@example.com', 'previo@example.com', 'hash', 'Nuevo', 'ADMIN')`,
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
