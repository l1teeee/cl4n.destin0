import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "../config/env.ts";
import { databaseSsl } from "../config/database-env.ts";
import { log } from "../observability/logger.ts";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 3_000,
  ssl: databaseSsl(env),
});

pool.on("error", (error) => {
  const candidate = "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN";
  const code = /^[A-Z0-9_]+$/.test(candidate) ? candidate : "UNKNOWN";
  log("error", "database_idle_client_error", { code });
});

if (process.env.VERCEL) {
  attachDatabasePool(pool);
}

export const db = drizzle(pool);
