import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

describe("GET /api/health", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    const { pool } = await import("@/infrastructure/db/client");
    await pool.end();
  });

  it("reports that the database is reachable through the application pool", async () => {
    const { GET } = await import("@/app/api/health/route");
    const { pool } = await import("@/infrastructure/db/client");
    const response = await GET();
    const database = await pool.query<{ current_database: string }>("SELECT current_database()");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", db: "up" });
    expect(database.rows[0]?.current_database).toBe(testDatabaseUrl().pathname.slice(1));
  });
});
