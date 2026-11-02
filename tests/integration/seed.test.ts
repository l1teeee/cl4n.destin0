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

interface RowCounts {
  admins: number;
  events: number;
  reservations: number;
  waitlist_entries: number;
  contacts: number;
  messages: number;
  clues: number;
  audit_logs: number;
}

async function countRows(): Promise<RowCounts> {
  const result = await pool.query<RowCounts>(
    `SELECT
       (SELECT count(*)::int FROM admin_users WHERE email_normalized = 'admin@clandestino.local') AS admins,
       (SELECT count(*)::int FROM events) AS events,
       (SELECT count(*)::int FROM reservations) AS reservations,
       (SELECT count(*)::int FROM waitlist_entries) AS waitlist_entries,
       (SELECT count(*)::int FROM messaging_contacts) AS contacts,
       (SELECT count(*)::int FROM messages) AS messages,
       (SELECT count(*)::int FROM event_clues) AS clues,
       (SELECT count(*)::int FROM audit_logs) AS audit_logs`,
  );
  return result.rows[0]!;
}

describe("local seed", () => {
  it("refuses a non-local database URL", () => {
    expect(() => assertLocalDatabaseUrl("postgres://user:secret@example.com/cl4n")).toThrow(
      /rechazado/i,
    );
  });

  it("creates the demo data without breaking the seat invariant", async () => {
    await seedDatabase(testDatabaseUrl().toString(), vi.fn());

    const event = await pool.query<{
      status: string;
      capacity: number;
      reserved_seats: number;
      waitlisted_count: number;
      held_seats: number;
      waiting_entries: number;
    }>(
      `SELECT
         e.status,
         e.capacity,
         e.reserved_seats,
         e.waitlisted_count,
         (SELECT COALESCE(SUM(r.party_size), 0)::int
            FROM reservations r
           WHERE r.event_id = e.id AND r.status = 'CONFIRMED') AS held_seats,
         (SELECT count(*)::int
            FROM waitlist_entries w
           WHERE w.event_id = e.id AND w.status = 'WAITING') AS waiting_entries
       FROM events e
       WHERE e.slug = 'demo'`,
    );
    expect(event.rows[0]).toMatchObject({
      status: "SCHEDULED",
      capacity: 10,
      reserved_seats: 10,
      held_seats: 10,
      waitlisted_count: 3,
      waiting_entries: 3,
    });

    const payment = await pool.query(
      `SELECT bank_name, account_type, account_number, account_holder, payment_link
         FROM payment_settings`,
    );
    expect(payment.rows).toEqual([
      {
        bank_name: "Banco Demo",
        account_type: "Ahorro",
        account_number: "000-000000-0",
        account_holder: "Clandestino Demo",
        payment_link: null,
      },
    ]);
    const prices = await pool.query<{ price_cents: number | null }>(
      "SELECT DISTINCT price_cents FROM events",
    );
    expect(prices.rows).toEqual([{ price_cents: 3500 }]);

    const stages = await pool.query<{ stage: string; status: string; requests: number }>(
      `SELECT r.stage, r.status, count(*)::int AS requests
       FROM reservations r
       JOIN events e ON e.id = r.event_id
       WHERE e.slug = 'demo'
       GROUP BY r.stage, r.status
       ORDER BY r.status::text, r.stage`,
    );
    expect(stages.rows).toEqual([
      { stage: "IN_REVIEW", status: "CANCELLED", requests: 1 },
      { stage: "PAID", status: "CANCELLED", requests: 1 },
      { stage: "IN_REVIEW", status: "CONFIRMED", requests: 2 },
      { stage: "ON_LIST", status: "CONFIRMED", requests: 2 },
      { stage: "PAID", status: "CONFIRMED", requests: 2 },
      { stage: "IN_REVIEW", status: "FULL_REJECTED", requests: 1 },
    ]);

    const refunds = await pool.query<{ refund_status: string }>(
      "SELECT refund_status FROM reservations WHERE refund_status IS NOT NULL",
    );
    expect(refunds.rows).toEqual([{ refund_status: "PENDING" }]);

    const statuses = await pool.query<{ status: string }>(
      "SELECT DISTINCT status FROM messages ORDER BY status",
    );
    expect(statuses.rows.map((row) => row.status)).toEqual([
      "FAILED",
      "READ",
      "RECEIVED",
      "SENT",
      "SENT_MANUALLY",
      "WAITING_CONTACT",
      "WAITING_WINDOW",
    ]);

    const windows = await pool.query<{ username: string; window_open: boolean }>(
      `SELECT username, last_inbound_at > clock_timestamp() - INTERVAL '24 hours' AS window_open
       FROM messaging_contacts
       ORDER BY username`,
    );
    expect(windows.rows).toEqual([
      { username: "demo.ana.lopez", window_open: true },
      { username: "demo.carlos.mejia", window_open: true },
      { username: "demo.curioso.sv", window_open: true },
      { username: "demo.marta.guzman", window_open: false },
    ]);

    const unlinked = await pool.query<{ username: string }>(
      `SELECT c.username
       FROM messaging_contacts c
       WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.contact_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM waitlist_entries w WHERE w.contact_id = c.id)`,
    );
    expect(unlinked.rows).toEqual([{ username: "demo.curioso.sv" }]);

    const past = await pool.query<{ status: string; clues: number }>(
      `SELECT e.status, (SELECT count(*)::int FROM event_clues c WHERE c.event_id = e.id) AS clues
       FROM events e
       WHERE e.slug = 'demo-pasada'`,
    );
    expect(past.rows).toEqual([{ status: "COMPLETED", clues: 2 }]);
  });

  it("is idempotent and leaves existing rows unchanged", async () => {
    const before = await countRows();
    expect(before).toMatchObject({ admins: 1, events: 2, contacts: 4, clues: 2 });

    const log = vi.fn();
    await seedDatabase(testDatabaseUrl().toString(), log);

    expect(await countRows()).toEqual(before);
    const output = log.mock.calls.flat().join(" ");
    expect(output).toMatch(/demo ya existe; no se modifico/);
    expect(output).toMatch(/demo-pasada ya existe; no se modifico/);
  });
});
