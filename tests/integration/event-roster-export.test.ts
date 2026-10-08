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
       email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at,
       accepted_at
     ) VALUES ($1, 7, 'CONFIRMED', '=Ana Pérez', 'anaperez', '+50370000007',
       'ana@example.com', 'ana@example.com', 2, now(), $2, now(), now())`,
    [eventId, randomUUID()],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("event roster CSV route", () => {
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
  });
});
