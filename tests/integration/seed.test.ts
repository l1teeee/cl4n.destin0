import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { assertLocalDatabaseUrl, seedDatabase } from "../../scripts/seed";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
});

afterAll(async () => {
  await pool.end();
});

describe("local seed", () => {
  it("refuses a non-local database URL", () => {
    expect(() => assertLocalDatabaseUrl("postgres://user:secret@example.com/cl4n")).toThrow(
      /rechazado/i,
    );
  });

  it("is idempotent and leaves existing rows unchanged", async () => {
    const databaseUrl = testDatabaseUrl().toString();
    const log = vi.fn();
    await seedDatabase(databaseUrl, log);
    const first = await pool.query<{
      admin_count: number;
      event_count: number;
      event_id: string;
      opens_at: Date;
      closes_at: Date;
      starts_at: Date;
    }>(
      `SELECT
         (SELECT count(*)::int FROM admin_users WHERE email_normalized = 'admin@clandestino.local') AS admin_count,
         (SELECT count(*)::int FROM events WHERE slug = 'cena-clandestino-demo') AS event_count,
         e.id AS event_id,
         e.opens_at,
         e.closes_at,
         e.starts_at
       FROM events e
       WHERE e.slug = 'cena-clandestino-demo'`,
    );
    expect(first.rows[0]).toMatchObject({ admin_count: 1, event_count: 1 });
    expect(first.rows[0]!.closes_at.getTime() - first.rows[0]!.opens_at.getTime()).toBe(
      14 * 86_400_000 + 3_600_000,
    );
    expect(first.rows[0]!.starts_at.getTime() - first.rows[0]!.closes_at.getTime()).toBe(
      86_400_000,
    );

    await seedDatabase(databaseUrl, log);
    const second = await pool.query<{
      admin_count: number;
      event_count: number;
      event_id: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM admin_users WHERE email_normalized = 'admin@clandestino.local') AS admin_count,
         (SELECT count(*)::int FROM events WHERE slug = 'cena-clandestino-demo') AS event_count,
         e.id AS event_id
       FROM events e
       WHERE e.slug = 'cena-clandestino-demo'`,
    );
    expect(second.rows[0]).toEqual({
      admin_count: 1,
      event_count: 1,
      event_id: first.rows[0]!.event_id,
    });
    expect(log.mock.calls.flat().join(" ")).toMatch(/ya existe; no se modificó/);
  });
});
