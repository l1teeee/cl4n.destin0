import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { env } from "../config/env.ts";

function databaseSsl(): PoolConfig["ssl"] {
  if (env.DATABASE_SSL_MODE === "disable") {
    return false;
  }

  if (env.DATABASE_SSL_MODE === "require-no-verify") {
    return { rejectUnauthorized: false };
  }

  return {
    ca: env.DATABASE_CA_CERT,
    checkServerIdentity: () => undefined,
  };
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 5_000,
  ssl: databaseSsl(),
});

if (process.env.VERCEL) {
  attachDatabasePool(pool);
}

export const db = drizzle(pool);
