import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "../src/infrastructure/db/client.ts";
import { env } from "../src/infrastructure/config/env.ts";

const target = new URL(env.DATABASE_URL);
const database = target.pathname.slice(1);

console.log(`Migrating ${target.hostname}:${target.port || "5432"}/${database}`);

try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migrations complete");
} finally {
  await pool.end();
}
