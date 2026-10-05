import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

export function testDatabaseUrl(): URL {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error("TEST_DATABASE_URL is required for integration tests");
  }

  const target = new URL(value);
  if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
    throw new Error("TEST_DATABASE_URL must point to 127.0.0.1 or localhost");
  }

  const database = target.pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("TEST_DATABASE_URL has an invalid database name");
  }

  return target;
}

export async function resetTestDatabase(): Promise<void> {
  const target = testDatabaseUrl();
  const database = target.pathname.slice(1);
  const maintenanceUrl = new URL(target);
  maintenanceUrl.pathname = "/postgres";

  const maintenanceClient = new Client({ connectionString: maintenanceUrl.toString() });
  await maintenanceClient.connect();
  try {
    const existing = await maintenanceClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      database,
    ]);
    if (existing.rowCount === 0) {
      await maintenanceClient.query(`CREATE DATABASE ${database}`);
    }
  } finally {
    await maintenanceClient.end();
  }

  const pool = new Pool({ connectionString: target.toString() });
  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });
  } finally {
    await pool.end();
  }
}
