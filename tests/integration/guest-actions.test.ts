import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import {
  acceptRequestAction,
  addRequestAction,
} from "@/app/admin/(protected)/events/guest-actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";

import { resetTestDatabase } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
let pool: Pool;
let eventId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('guest-actions@example.com', 'guest-actions@example.com', 'hash', 'Guest Actions')
     RETURNING id`,
  );
  authState.token = (await postgresAdminAuthRepository.createSession(
    admin.rows[0]!.id,
    "hash",
    null,
  ))!.token;
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (
       internal_name, slug, starts_at, capacity, max_party_size,
       opens_at, closes_at, waitlist_capacity, status
     )
     VALUES ('Acciones', 'guest-actions', clock_timestamp() + interval '7 days', 2, 2,
             clock_timestamp() - interval '1 day', clock_timestamp() + interval '6 days', 2,
             'SCHEDULED')
     RETURNING id`,
  );
  eventId = event.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

function guestForm(): FormData {
  const formData = new FormData();
  formData.set("partySize", "1");
  formData.set("guest1Name", "Ana Acción");
  formData.set("guest1Instagram", "@ana.accion");
  formData.set("hasAllergies", "false");
  formData.set("notes", "");
  return formData;
}

describe("guest admin Server Actions", () => {
  it("returns a field error when the allergy answer is absent", async () => {
    const formData = guestForm();
    formData.delete("hasAllergies");

    expect(await addRequestAction(eventId, initialState, formData)).toMatchObject({
      ok: false,
      fieldErrors: { hasAllergies: "Indica si hay alergias." },
    });
  });

  it("adds and accepts a request, delivers synchronously, and revalidates the event", async () => {
    const added = await addRequestAction(eventId, initialState, guestForm());
    expect(added).toEqual({
      ok: true,
      message: "Se agregó a Ana Acción a la lista para revisión.",
    });
    const reservation = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE event_id = $1",
      [eventId],
    );
    const accepted = await acceptRequestAction(
      reservation.rows[0]!.id,
      initialState,
      new FormData(),
    );
    expect(accepted).toEqual({
      ok: true,
      message:
        "Aceptaste a Ana Acción. Ya está en la lista. El mensaje quedó pendiente: todavía no nos ha escrito por Instagram.",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    await expect(
      pool.query("SELECT stage, source, created_by FROM reservations WHERE id = $1", [
        reservation.rows[0]!.id,
      ]),
    ).resolves.toMatchObject({
      rows: [{ stage: "ON_LIST", source: "ADMIN", created_by: expect.any(String) }],
    });
  });
});
