import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";

import { testDatabaseUrl } from "../helpers/test-db";

function migrationsBefore(tag: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cl4n-location-release-migrations-"));
  cpSync(path.resolve("drizzle"), directory, { recursive: true });
  const journalPath = path.join(directory, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const target = journal.entries.find((entry) => entry.tag === tag);
  if (!target) throw new Error(`Migration ${tag} not found`);
  for (const entry of journal.entries.filter((entry) => entry.idx >= target.idx)) {
    rmSync(path.join(directory, `${entry.tag}.sql`));
  }
  journal.entries = journal.entries.filter((entry) => entry.idx < target.idx);
  writeFileSync(journalPath, JSON.stringify(journal));
  return directory;
}

async function maintenance(work: (client: Client) => Promise<void>): Promise<void> {
  const url = testDatabaseUrl();
  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

describe("migration 0008 location release and coordinates", () => {
  it("backfills only the released current revision and enforces all new checks", async () => {
    const url = testDatabaseUrl();
    const database = `${url.pathname.slice(1)}_location_release`;
    url.pathname = `/${database}`;
    const previous = migrationsBefore("0008_location_release_coordinates");
    await maintenance(async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${database}`);
    });

    const pool = new Pool({ connectionString: url.toString() });
    try {
      await migrate(drizzle(pool), { migrationsFolder: previous });
      const events = await pool.query<{ id: string; slug: string }>(
        `INSERT INTO events (
           slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at,
           location_address, location_status, location_confirmed_at, location_revision
         ) VALUES
           ('released-current', 'Released current', now() + interval '2 days', 10, 2,
            now(), now() + interval '1 day', 'Calle 1', 'CONFIRMED', now(), 2),
           ('released-old', 'Released old', now() + interval '2 days', 10, 2,
            now(), now() + interval '1 day', 'Calle 2', 'CONFIRMED', now(), 2),
           ('never-released', 'Never released', now() + interval '2 days', 10, 2,
            now(), now() + interval '1 day', 'Calle 3', 'CONFIRMED', now(), 0)
         RETURNING id, slug`,
      );
      const eventIds = new Map(events.rows.map((event) => [event.slug, event.id]));
      for (const [index, slug] of ["released-current", "released-old"].entries()) {
        const reservation = await pool.query<{ id: string }>(
          `INSERT INTO reservations (
             event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
             email, email_normalized, party_size, terms_accepted_at, idempotency_key,
             submitted_at, accepted_at
           ) VALUES ($1, 1, 'CONFIRMED', $2, $3, $4, $5, $5, 1, now(), gen_random_uuid(),
                     now(), now())
           RETURNING id`,
          [
            eventIds.get(slug),
            `Guest ${index}`,
            `guest${index}`,
            `+5037000000${index}`,
            `guest${index}@example.com`,
          ],
        );
        await pool.query(
          `INSERT INTO email_outbox (kind, reservation_id, location_revision)
           VALUES ('EVENT_LOCATION', $1, $2)`,
          [reservation.rows[0]!.id, slug === "released-current" ? 2 : 1],
        );
      }

      await migrate(drizzle(pool), { migrationsFolder: path.resolve("drizzle") });

      const released = await pool.query<{
        slug: string;
        location_released_revision: number | null;
      }>(
        `SELECT slug, location_released_revision
           FROM events
          ORDER BY slug`,
      );
      expect(released.rows).toEqual([
        { slug: "never-released", location_released_revision: null },
        { slug: "released-current", location_released_revision: 2 },
        { slug: "released-old", location_released_revision: null },
      ]);

      const currentId = eventIds.get("released-current")!;
      await expect(
        pool.query("UPDATE events SET location_released_revision = -1 WHERE id = $1", [currentId]),
      ).rejects.toMatchObject({ constraint: "events_location_released_revision_chk" });
      await expect(
        pool.query("UPDATE events SET location_released_revision = 3 WHERE id = $1", [currentId]),
      ).rejects.toMatchObject({ constraint: "events_location_released_revision_chk" });
      await expect(
        pool.query("UPDATE events SET location_latitude = 13.7 WHERE id = $1", [currentId]),
      ).rejects.toMatchObject({ constraint: "events_location_coordinates_pair_chk" });
      await expect(
        pool.query(
          "UPDATE events SET location_latitude = 91, location_longitude = 0 WHERE id = $1",
          [currentId],
        ),
      ).rejects.toMatchObject({ constraint: "events_location_latitude_chk" });
      await expect(
        pool.query(
          "UPDATE events SET location_latitude = 0, location_longitude = -181 WHERE id = $1",
          [currentId],
        ),
      ).rejects.toMatchObject({ constraint: "events_location_longitude_chk" });
      await expect(
        pool.query(
          `UPDATE events
              SET location_released_revision = 0,
                  location_latitude = -90,
                  location_longitude = 180
            WHERE id = $1`,
          [currentId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await pool.end();
      rmSync(previous, { recursive: true, force: true });
      await maintenance(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      });
    }
  }, 15_000);
});
