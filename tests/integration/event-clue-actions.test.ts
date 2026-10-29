import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { revalidatePath } from "next/cache";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/email/outbox/schedule-email-delivery", () => ({
  scheduleEmailDelivery: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import {
  deleteEventClueAction,
  publishEventClueAction,
} from "@/app/admin/(protected)/events/actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
const closedMessage =
  "Las pistas solo se pueden publicar o borrar mientras la experiencia está cerrada.";
let pool: Pool;
let adminId: string;
let sessionToken: string;

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  authState.token = undefined;
  if (pool) await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('clues@example.com', 'clues@example.com', 'hash', 'Admin Pistas')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
  sessionToken = (await postgresAdminAuthRepository.createSession(adminId, "hash", null))!.token;
});

afterAll(async () => {
  if (pool) await pool.end();
});

async function insertEvent(status: "SCHEDULED" | "CLOSED"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       internal_name, slug, starts_at, capacity, max_party_size,
       opens_at, closes_at, auto_close_on_full, status
     ) VALUES ('Pistas', $1, '2027-11-21T01:30:00Z', 20, 4,
       '2027-11-01T14:00:00Z', '2027-11-21T02:00:00Z', false, $2::event_status)
     RETURNING id`,
    [`clue-actions-${randomUUID()}`, status],
  );
  return result.rows[0]!.id;
}

async function insertClue(eventId: string, body = "Pista de prueba"): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO event_clues (event_id, body, created_by) VALUES ($1, $2, $3) RETURNING id",
    [eventId, body, adminId],
  );
  return result.rows[0]!.id;
}

async function clueBodies(eventId: string): Promise<string[]> {
  const result = await pool.query<{ body: string }>(
    "SELECT body FROM event_clues WHERE event_id = $1 ORDER BY created_at, id",
    [eventId],
  );
  return result.rows.map((row) => row.body);
}

function bodyForm(body: string): FormData {
  const form = new FormData();
  form.set("body", body);
  return form;
}

describe("publishEventClueAction", () => {
  it("rejects a request without an admin session", async () => {
    const eventId = await insertEvent("CLOSED");

    expect(await publishEventClueAction(eventId, initialState, bodyForm("Sin sesión"))).toEqual({
      ok: false,
      message: "Tu sesión no es válida. Inicia sesión nuevamente.",
    });
    expect(await clueBodies(eventId)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("publishes the trimmed clue for a closed event, audits it and revalidates", async () => {
    const eventId = await insertEvent("CLOSED");
    authState.token = sessionToken;

    expect(
      await publishEventClueAction(eventId, initialState, bodyForm("  Mira bajo la mesa.  ")),
    ).toEqual({ ok: true, message: "Pista publicada." });

    expect(await clueBodies(eventId)).toEqual(["Mira bajo la mesa."]);
    const audit = await pool.query<{ actor_admin_id: string; action: string }>(
      "SELECT actor_admin_id, action FROM audit_logs WHERE entity_id = $1",
      [eventId],
    );
    expect(audit.rows).toEqual([{ actor_admin_id: adminId, action: "EVENT_UPDATED" }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/audit");
  });

  it("returns field errors for an empty or too long clue", async () => {
    const eventId = await insertEvent("CLOSED");
    authState.token = sessionToken;

    expect(await publishEventClueAction(eventId, initialState, bodyForm("   "))).toEqual({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { body: "Escribe la pista." },
    });
    expect(
      await publishEventClueAction(eventId, initialState, bodyForm("a".repeat(501))),
    ).toMatchObject({
      ok: false,
      fieldErrors: { body: "La pista no puede superar 500 caracteres." },
    });
    expect(
      await publishEventClueAction("not-a-uuid", initialState, bodyForm("Pista")),
    ).toMatchObject({ ok: false });
    expect(await clueBodies(eventId)).toEqual([]);
  });

  it("refuses to publish unless the experience is closed", async () => {
    const eventId = await insertEvent("SCHEDULED");
    authState.token = sessionToken;

    expect(await publishEventClueAction(eventId, initialState, bodyForm("Muy pronto"))).toEqual({
      ok: false,
      message: closedMessage,
    });
    expect(await clueBodies(eventId)).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a missing experience", async () => {
    authState.token = sessionToken;

    expect(await publishEventClueAction(randomUUID(), initialState, bodyForm("Pista"))).toEqual({
      ok: false,
      message: "No se encontró la experiencia.",
    });
  });
});

describe("deleteEventClueAction", () => {
  it("rejects a request without an admin session", async () => {
    const eventId = await insertEvent("CLOSED");
    const clueId = await insertClue(eventId);

    expect(await deleteEventClueAction(eventId, clueId, initialState, new FormData())).toEqual({
      ok: false,
      message: "Tu sesión no es válida. Inicia sesión nuevamente.",
    });
    expect(await clueBodies(eventId)).toEqual(["Pista de prueba"]);
  });

  it("deletes the clue of a closed event, audits it and revalidates", async () => {
    const eventId = await insertEvent("CLOSED");
    const clueId = await insertClue(eventId);
    authState.token = sessionToken;

    expect(await deleteEventClueAction(eventId, clueId, initialState, new FormData())).toEqual({
      ok: true,
      message: "Pista eliminada.",
    });

    expect(await clueBodies(eventId)).toEqual([]);
    const audit = await pool.query<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1",
      [eventId],
    );
    expect(audit.rows).toEqual([{ metadata: { clueRemoved: clueId } }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/audit");
  });

  it("reports a clue that does not exist or belongs to another experience", async () => {
    const eventId = await insertEvent("CLOSED");
    const otherEventId = await insertEvent("CLOSED");
    const otherClueId = await insertClue(otherEventId);
    authState.token = sessionToken;

    const expected = { ok: false, message: "No se encontró la pista." };
    expect(
      await deleteEventClueAction(eventId, randomUUID(), initialState, new FormData()),
    ).toEqual(expected);
    expect(await deleteEventClueAction(eventId, otherClueId, initialState, new FormData())).toEqual(
      expected,
    );
    expect(await clueBodies(otherEventId)).toEqual(["Pista de prueba"]);
  });

  it("refuses to delete unless the experience is closed", async () => {
    const eventId = await insertEvent("SCHEDULED");
    const clueId = await insertClue(eventId);
    authState.token = sessionToken;

    expect(await deleteEventClueAction(eventId, clueId, initialState, new FormData())).toEqual({
      ok: false,
      message: closedMessage,
    });
    expect(await clueBodies(eventId)).toEqual(["Pista de prueba"]);
  });

  it("reports a missing experience and invalid identifiers", async () => {
    authState.token = sessionToken;

    expect(
      await deleteEventClueAction(randomUUID(), randomUUID(), initialState, new FormData()),
    ).toEqual({ ok: false, message: "No se encontró la experiencia." });
    expect(
      await deleteEventClueAction("not-a-uuid", "also-not", initialState, new FormData()),
    ).toMatchObject({ ok: false });
  });
});
