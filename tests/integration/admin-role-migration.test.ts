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

describe("migration 0002_admin_roles", () => {
  it("promotes existing admins to super admin and defaults new admins to admin", async () => {
    const target = testDatabaseUrl();
    const database = `${target.pathname.slice(1)}_roles`;
    target.pathname = `/${database}`;
    const previousMigrations = migrationsWithout("0002_admin_roles");

    await withMaintenanceClient(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: target.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previousMigrations });
      await pool.query(
        `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
         VALUES ('previo@example.com', 'previo@example.com', 'hash', 'Previo')`,
      );

      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      const existing = await pool.query("SELECT email_normalized, role FROM admin_users");
      expect(existing.rows).toEqual([
        { email_normalized: "previo@example.com", role: "SUPER_ADMIN" },
      ]);

      const created = await pool.query<{ role: string }>(
        `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
         VALUES ('nuevo@example.com', 'nuevo@example.com', 'hash', 'Nuevo')
         RETURNING role`,
      );
      expect(created.rows[0]!.role).toBe("ADMIN");

      await pool.query(
        `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id)
         VALUES ('SYSTEM', 'ADMIN_SESSIONS_REVOKED', 'ADMIN_USER', gen_random_uuid())`,
      );
    } finally {
      await pool.end();
      rmSync(previousMigrations, { recursive: true, force: true });
      await withMaintenanceClient(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  });
});
