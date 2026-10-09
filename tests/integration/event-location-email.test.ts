import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { deliverPendingEmails } from "@/application/notifications/deliver-pending-emails";
import { PostgresEventLocationEmailRepository } from "@/infrastructure/db/repositories/postgres-event-location-email-repository";
import { PostgresOutboxEmailComposer } from "@/infrastructure/email/outbox/outbox-email-composer";
import { PostgresEmailOutboxRepository } from "@/infrastructure/email/outbox/postgres-email-outbox-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresEventLocationEmailRepository;
let actorId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventLocationEmailRepository(pool);
});

beforeEach(async () => {
  await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventLocationEmailRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, 'hash', 'Admin') RETURNING id`,
    [`${randomUUID()}@example.com`],
  );
  actorId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

async function insertEvent(status: "PENDING" | "CONFIRMED" = "CONFIRMED"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at,
       location_address, location_status, location_confirmed_at
     ) VALUES ($1, 'Location email', now() + interval '2 days', 20, 4, now(),
               now() + interval '1 day', 'Calle 1', $2::event_location_status,
               CASE WHEN $2::event_location_status = 'CONFIRMED' THEN now() ELSE NULL END)
     RETURNING id`,
    [`location-${randomUUID()}`, status],
  );
  return result.rows[0]!.id;
}

async function insertReservation(
  eventId: string,
  status: "CONFIRMED" | "FULL_REJECTED" | "CANCELLED",
  number: number,
): Promise<string> {
  const confirmed = status === "CONFIRMED";
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
       email, email_normalized, party_size, terms_accepted_at, idempotency_key,
       submitted_at, accepted_at, cancelled_at
     ) VALUES ($1, $2, $3::reservation_status, $4, $5, $6, $7, $7, 1, now(), gen_random_uuid(), now(),
               CASE WHEN $8 THEN now() ELSE NULL END,
               CASE WHEN $3::reservation_status = 'CANCELLED' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      eventId,
      confirmed ? number : null,
      status,
      `Guest ${number}`,
      `guest${number}`,
      `+5037${String(number).padStart(7, "0")}`,
      `${randomUUID()}@example.com`,
      confirmed,
    ],
  );
  return result.rows[0]!.id;
}

async function insertWaitlistEntry(eventId: string): Promise<void> {
  await pool.query(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
       email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
     ) VALUES ($1, 1, 'WAITING', 'Waiting', 'waiting', '+50379999999',
               $2, $2, 1, now(), gen_random_uuid(), now())`,
    [eventId, `${randomUUID()}@example.com`],
  );
}

async function locationRows() {
  return (
    await pool.query<{
      reservation_id: string;
      location_revision: number;
      payload: { isUpdate: boolean };
    }>(
      `SELECT reservation_id, location_revision, payload
         FROM email_outbox
        WHERE kind = 'EVENT_LOCATION'
        ORDER BY reservation_id, location_revision`,
    )
  ).rows;
}

async function send(eventId: string) {
  const current = await pool.query<{ location_revision: number; location_status: string }>(
    "SELECT location_revision, location_status FROM events WHERE id = $1",
    [eventId],
  );
  const row = current.rows[0]!;
  return repository.queue(
    eventId,
    { revision: row.location_revision, status: row.location_status as "PENDING" | "CONFIRMED" },
    actorId,
  );
}

describe("event location email enqueue", () => {
  it("queues only confirmed reservations and skips rejected, cancelled and waitlisted guests", async () => {
    const eventId = await insertEvent();
    const confirmed = await insertReservation(eventId, "CONFIRMED", 1);
    await insertReservation(eventId, "FULL_REJECTED", 2);
    await insertReservation(eventId, "CANCELLED", 3);
    await insertWaitlistEntry(eventId);

    await expect(send(eventId)).resolves.toMatchObject({
      ok: true,
      queued: 1,
    });
    expect(await locationRows()).toEqual([
      { reservation_id: confirmed, location_revision: 0, payload: { isUpdate: false } },
    ]);
  });

  it("queues zero on a second send of the same revision", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId, "CONFIRMED", 1);
    await send(eventId);
    await expect(send(eventId)).resolves.toMatchObject({
      ok: true,
      queued: 0,
    });
  });

  it("queues everyone again after a location revision change and marks sent guests as updates", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId, "CONFIRMED", 1);
    await insertReservation(eventId, "CONFIRMED", 2);
    await send(eventId);
    await pool.query(
      `UPDATE email_outbox
          SET status = 'SENT', sent_at = now()
        WHERE kind = 'EVENT_LOCATION'`,
    );
    await pool.query(
      `UPDATE events
          SET location_address = 'Calle 2', location_revision = location_revision + 1
        WHERE id = $1`,
      [eventId],
    );

    await expect(send(eventId)).resolves.toMatchObject({
      ok: true,
      queued: 2,
      locationRevision: 1,
    });
    const current = (await locationRows()).filter((row) => row.location_revision === 1);
    expect(current).toHaveLength(2);
    expect(current.every((row) => row.payload.isUpdate)).toBe(true);
  });

  it("queues only a newly promoted reservation after the original send", async () => {
    const eventId = await insertEvent();
    const original = await insertReservation(eventId, "CONFIRMED", 1);
    await send(eventId);
    const promoted = await insertReservation(eventId, "CONFIRMED", 2);
    await pool.query(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key,
         submitted_at, promoted_reservation_id, promoted_at
       ) VALUES ($1, 1, 'PROMOTED', 'Promoted', 'promoted', '+50378888888',
                 $2, $2, 1, now(), gen_random_uuid(), now(), $3, now())`,
      [eventId, `${randomUUID()}@example.com`, promoted],
    );

    await expect(send(eventId)).resolves.toMatchObject({
      ok: true,
      queued: 1,
    });
    const rows = await locationRows();
    expect(rows.map((row) => row.reservation_id).sort()).toEqual([original, promoted].sort());
    expect(rows.find((row) => row.reservation_id === promoted)?.payload.isUpdate).toBe(false);
  });

  it("rejects sends while the location is pending", async () => {
    const eventId = await insertEvent("PENDING");
    await expect(send(eventId)).resolves.toEqual({
      ok: false,
      error: "LOCATION_NOT_CONFIRMED",
    });
  });

  it("queues every reservation once under concurrent sends", async () => {
    const eventId = await insertEvent();
    for (let number = 1; number <= 12; number += 1) {
      await insertReservation(eventId, "CONFIRMED", number);
    }

    const results = await Promise.all([send(eventId), send(eventId)]);
    expect(results.reduce((total, result) => total + (result.ok ? result.queued : 0), 0)).toBe(12);
    expect(await locationRows()).toHaveLength(12);
  });

  it("writes the queued count and revision to one audit row", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId, "CONFIRMED", 1);
    await send(eventId);
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata
         FROM audit_logs
        WHERE entity_id = $1 AND action = 'EVENT_UPDATED'`,
      [eventId],
    );
    expect(audit.rows).toEqual([{ metadata: { locationEmailsQueued: 1, locationRevision: 0 } }]);
  });
});

describe("event location email resend and version binding", () => {
  it("revives only FAILED rows of the current revision and leaves PENDING and SENT untouched", async () => {
    const eventId = await insertEvent();
    const failed = await insertReservation(eventId, "CONFIRMED", 1);
    const sent = await insertReservation(eventId, "CONFIRMED", 2);
    const pending = await insertReservation(eventId, "CONFIRMED", 3);
    await send(eventId);
    await pool.query(
      `UPDATE email_outbox SET status = 'FAILED', attempts = 3, last_error = 'LOCATION_NOT_CONFIRMED'
        WHERE reservation_id = $1`,
      [failed],
    );
    await pool.query(
      `UPDATE email_outbox SET status = 'SENT', sent_at = now() WHERE reservation_id = $1`,
      [sent],
    );

    await expect(send(eventId)).resolves.toMatchObject({ ok: true, queued: 1 });

    const rows = await pool.query<{ reservation_id: string; status: string; attempts: number }>(
      "SELECT reservation_id, status, attempts, last_error FROM email_outbox WHERE kind = 'EVENT_LOCATION'",
    );
    const byReservation = new Map(rows.rows.map((row) => [row.reservation_id, row]));
    expect(byReservation.get(failed)).toMatchObject({
      status: "PENDING",
      attempts: 0,
      last_error: null,
    });
    expect(byReservation.get(sent)?.status).toBe("SENT");
    expect(byReservation.get(pending)?.status).toBe("PENDING");
    expect(rows.rowCount).toBe(3);

    const summary = await repository.getSummary(eventId);
    expect(summary).toMatchObject({ failed: 0, sendable: 0 });
  });

  it("counts FAILED rows as sendable and revives them once under concurrent sends", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId, "CONFIRMED", 1);
    await insertReservation(eventId, "CONFIRMED", 2);
    await send(eventId);
    await pool.query("UPDATE email_outbox SET status = 'FAILED', last_error = 'INTERNAL'");
    await expect(repository.getSummary(eventId)).resolves.toMatchObject({
      failed: 2,
      notYetQueued: 0,
      sendable: 2,
    });

    const results = await Promise.all([send(eventId), send(eventId)]);
    const queued = results.map((result) => (result.ok ? result.queued : -1));
    expect(queued.reduce((total, value) => total + value, 0)).toBe(2);
    const rows = await pool.query("SELECT 1 FROM email_outbox WHERE kind = 'EVENT_LOCATION'");
    expect(rows.rowCount).toBe(2);
  });

  it("rejects a send bound to an outdated location version", async () => {
    const eventId = await insertEvent();
    await insertReservation(eventId, "CONFIRMED", 1);
    await pool.query("UPDATE events SET location_revision = 1 WHERE id = $1", [eventId]);

    await expect(
      repository.queue(eventId, { revision: 0, status: "CONFIRMED" }, actorId),
    ).resolves.toEqual({ ok: false, error: "LOCATION_CHANGED" });
    await expect(
      repository.queue(eventId, { revision: 1, status: "PENDING" }, actorId),
    ).resolves.toEqual({ ok: false, error: "LOCATION_CHANGED" });
    const rows = await pool.query("SELECT 1 FROM email_outbox");
    expect(rows.rowCount).toBe(0);
  });
});

describe("event location email composition failures", () => {
  it.each([
    {
      code: "LOCATION_SUPERSEDED",
      mutate: async (eventId: string) =>
        pool.query("UPDATE events SET location_revision = 1 WHERE id = $1", [eventId]),
    },
    {
      code: "RESERVATION_NOT_CONFIRMED",
      mutate: async (_eventId: string, reservationId: string) =>
        pool.query(
          "UPDATE reservations SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1",
          [reservationId],
        ),
    },
    {
      code: "LOCATION_NOT_CONFIRMED",
      mutate: async (eventId: string) =>
        pool.query(
          "UPDATE events SET location_status = 'PENDING', location_confirmed_at = NULL WHERE id = $1",
          [eventId],
        ),
    },
  ])("marks $code as a permanent failure", async ({ code, mutate }) => {
    const eventId = await insertEvent();
    const reservationId = await insertReservation(eventId, "CONFIRMED", 1);
    await send(eventId);
    await mutate(eventId, reservationId);
    const sender = { send: vi.fn().mockResolvedValue(undefined) };

    const summary = await deliverPendingEmails(
      {
        repository: new PostgresEmailOutboxRepository(pool),
        composer: new PostgresOutboxEmailComposer(pool),
        sender,
        now: Date.now,
        logFailure: () => undefined,
        logStaleLease: () => undefined,
      },
      { limit: 1, timeBudgetMs: 20_000 },
    );

    expect(summary).toEqual({ delivered: 0, retried: 0, failed: 1 });
    expect(sender.send).not.toHaveBeenCalled();
    await expect(
      pool.query("SELECT status, last_error FROM email_outbox WHERE kind = 'EVENT_LOCATION'"),
    ).resolves.toMatchObject({ rows: [{ status: "FAILED", last_error: code }] });
  });
});
