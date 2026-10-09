import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { GET } from "@/app/admin/(protected)/events/[id]/export/route";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { queryEventRoster } from "@/infrastructure/db/repositories/event-roster-queries";

import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

let pool: Pool;
let eventId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('export@example.com', 'export@example.com', 'hash', 'Export Admin')
     RETURNING id`,
  );
  authState.token = (await postgresAdminAuthRepository.createSession(
    admin.rows[0]!.id,
    "hash",
    null,
  ))!.token;
  const event = await insertTestEvent(pool);
  eventId = event.id;
  await pool.query(
    `INSERT INTO reservations (
       event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
       email, email_normalized, party_size, allergies, terms_accepted_at, idempotency_key,
       submitted_at, accepted_at
     ) VALUES ($1, 7, 'CONFIRMED', '=Ana Pérez', 'anaperez', '+50370000007',
       'ana@example.com', 'ana@example.com', 2, '=Maní', now(), $2, now(), now())`,
    [eventId, randomUUID()],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("event roster CSV route", () => {
  it("returns allergies in the roster query", async () => {
    const roster = await queryEventRoster(pool, eventId, "confirmadas");

    expect(roster).toHaveLength(1);
    expect(roster[0]!.allergies).toBe("=Maní");
  });

  it("returns 401 without a valid session", async () => {
    const token = authState.token;
    authState.token = undefined;
    const response = await GET(new Request(`http://localhost/admin/events/${eventId}/export`), {
      params: Promise.resolve({ id: eventId }),
    });
    authState.token = token;

    expect(response.status).toBe(401);
  });

  it("returns a BOM-prefixed CSV with the selected rows", async () => {
    const response = await GET(
      new Request(`http://localhost/admin/events/${eventId}/export?vista=confirmadas`),
      { params: Promise.resolve({ id: eventId }) },
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body = new TextDecoder().decode(bytes.slice(3));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="clandestino-.+-confirmadas-\d{8}\.csv"$/,
    );
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body).toContain('"Confirmada","#007"');
    expect(body).toContain('"\'=Ana Pérez"');
    expect(body).toContain('"Alergias"');
    expect(body).toContain('"\'=Maní"');
  });
});

describe("roster email column", () => {
  it("ignores location emails when picking the latest delivery status", async () => {
    const event = await insertTestEvent(pool);
    const reservation = await pool.query<{ id: string }>(
      `INSERT INTO reservations (
         event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key,
         submitted_at, accepted_at
       ) VALUES ($1, 1, 'CONFIRMED', 'Luz', 'luz', '+50370000001',
         'luz@example.com', 'luz@example.com', 1, now(), $2, now(), now())
       RETURNING id`,
      [event.id, randomUUID()],
    );
    const reservationId = reservation.rows[0]!.id;
    await pool.query(
      `INSERT INTO email_outbox (kind, reservation_id, status, attempts, last_error, created_at)
       VALUES ('RESERVATION_CONFIRMED', $1, 'FAILED', 1, 'HTTP_400', now() - interval '1 minute')`,
      [reservationId],
    );
    await pool.query(
      `INSERT INTO email_outbox (kind, reservation_id, location_revision, status, sent_at)
       VALUES ('EVENT_LOCATION', $1, 0, 'SENT', now())`,
      [reservationId],
    );

    const roster = await queryEventRoster(pool, event.id, "confirmadas");

    expect(roster[0]).toMatchObject({ emailStatus: "FAILED", emailLastError: "HTTP_400" });
  });

  it("returns the current location status or the latest older sent status per guest", async () => {
    const event = await insertTestEvent(pool);
    await pool.query("UPDATE events SET location_revision = 2 WHERE id = $1", [event.id]);
    const reservations: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const reservation = await pool.query<{ id: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
           email, email_normalized, party_size, terms_accepted_at, idempotency_key,
           submitted_at, accepted_at
         ) VALUES ($1, $2, 'CONFIRMED', $3, $4, $5, $6, $6, 1, now(), $7, now(), now())
         RETURNING id`,
        [
          event.id,
          index + 1,
          `Location ${index}`,
          `location${index}`,
          `+5037111111${index}`,
          `location${index}@example.com`,
          randomUUID(),
        ],
      );
      reservations.push(reservation.rows[0]!.id);
    }

    await pool.query(
      `INSERT INTO email_outbox (
         kind, reservation_id, location_revision, payload, status, sent_at
       ) VALUES
         ('EVENT_LOCATION', $1, 2, '{"isUpdate": false}', 'SENT', now()),
         ('EVENT_LOCATION', $2, 1, '{"isUpdate": false}', 'SENT', now() - interval '1 hour'),
         ('EVENT_LOCATION', $2, 2, '{"isUpdate": true}', 'SENT', now()),
         ('EVENT_LOCATION', $3, 1, '{"isUpdate": false}', 'SENT', now()),
         ('EVENT_LOCATION', $4, 1, '{"isUpdate": false}', 'SENT', now() - interval '1 hour'),
         ('EVENT_LOCATION', $4, 2, '{"isUpdate": false}', 'FAILED', NULL)`,
      [reservations[1], reservations[2], reservations[3], reservations[4]],
    );

    const roster = await queryEventRoster(pool, event.id, "confirmadas");

    expect(roster.map((row) => row.locationEmail)).toEqual([
      null,
      { status: "SENT", isUpdate: false, sentAt: expect.any(Date), current: true },
      { status: "SENT", isUpdate: true, sentAt: expect.any(Date), current: true },
      { status: "SENT", isUpdate: false, sentAt: expect.any(Date), current: false },
      { status: "FAILED", isUpdate: false, sentAt: null, current: true },
    ]);

    await pool.query(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
       ) VALUES ($1, 1, 'WAITING', 'Waiting', 'waiting-location', '+50372222222',
                 'waiting-location@example.com', 'waiting-location@example.com', 1, now(), $2, now())`,
      [event.id, randomUUID()],
    );
    await expect(queryEventRoster(pool, event.id, "en-cola")).resolves.toMatchObject([
      { locationEmail: null },
    ]);
  });
});
