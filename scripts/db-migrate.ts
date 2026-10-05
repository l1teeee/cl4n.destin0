import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { databaseSsl, parseDatabaseEnv } from "../src/infrastructure/config/database-env.ts";

const environment = parseDatabaseEnv(process.env);
const target = new URL(environment.DATABASE_URL);
const database = target.pathname.slice(1);
const pool = new Pool({
  connectionString: environment.DATABASE_URL,
  connectionTimeoutMillis: 3_000,
  ssl: databaseSsl(environment),
});
const db = drizzle(pool);

console.log(`Migrating ${target.hostname}:${target.port || "5432"}/${database}`);

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migrations complete");
} finally {
  await pool.end();
}
