import { pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  databaseSsl,
  type DatabaseEnv,
  isLocalDatabaseHost,
  parseDatabaseEnv,
} from "../src/infrastructure/config/database-env.ts";

export function validateMigrationTarget(environment: DatabaseEnv): void {
  const target = new URL(environment.DATABASE_URL);
  if (environment.DATABASE_SSL_MODE === "disable" && !isLocalDatabaseHost(target.hostname)) {
    throw new Error("DATABASE_SSL_MODE=disable solo se permite para una base de datos local");
  }
}

export async function migrateDatabase(): Promise<void> {
  const environment = parseDatabaseEnv(process.env);
  validateMigrationTarget(environment);

  const target = new URL(environment.DATABASE_URL);
  const database = target.pathname.slice(1);
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    connectionTimeoutMillis: 3_000,
    ssl: databaseSsl(environment),
  });
  const db = drizzle(pool);

  console.log(
    `Migrating ${target.hostname}:${target.port || "5432"}/${database} (TLS: ${environment.DATABASE_SSL_MODE})`,
  );

  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("Migrations complete");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrateDatabase().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
