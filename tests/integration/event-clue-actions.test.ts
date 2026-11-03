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
vi.mock("@/infrastructure/messaging/schedule-message-delivery", () => ({
  scheduleMessageDelivery: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import {
  deleteEventClueAction,
  sendClueToAllAction,
  sendClueToPersonAction,
} from "@/app/admin/(protected)/events/actions";
import { POST } from "@/app/admin/(protected)/events/[id]/clues/route";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import * as messageDelivery from "@/infrastructure/messaging/drain-message-outbox";
import { scheduleMessageDelivery } from "@/infrastructure/messaging/schedule-message-delivery";

import { insertGuestReservation, insertMessagingContact } from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
const closedMessage =
  "Las pistas solo se pueden publicar o borrar mientras la experiencia está cerrada.";
let pool: Pool;
let adminId: string;
let sessionToken: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(scheduleMessageDelivery).mockClear();
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
     ) VALUES ('Pistas', $1, '2098-11-21T01:30:00Z', 20, 4,
       '2098-11-01T14:00:00Z', '2098-11-21T02:00:00Z', false, $2::event_status)
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

function clueRequest(eventId: string, body: string): Request {
  const form = new FormData();
  form.set("body", body);
  return new Request(`http://localhost/admin/events/${eventId}/clues`, {
    method: "POST",
    headers: { origin: "http://localhost", cookie: `cl4n_session=${sessionToken}` },
    body: form,
  });
}

describe("POST /admin/events/[id]/clues", () => {
  it("rejects a request without an admin session", async () => {
    const eventId = await insertEvent("CLOSED");
    authState.token = undefined;
    const response = await POST(clueRequest(eventId, "Sin sesión"), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(response.status).toBe(401);
    expect(await clueBodies(eventId)).toEqual([]);
  });

  it("publishes a trimmed clue for a closed event and audits it", async () => {
    const eventId = await insertEvent("CLOSED");
    authState.token = sessionToken;
    const response = await POST(clueRequest(eventId, "  Mira bajo la mesa.  "), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: expect.any(String) });
    expect(await clueBodies(eventId)).toEqual(["Mira bajo la mesa."]);
    const audit = await pool.query<{ actor_admin_id: string; action: string }>(
      "SELECT actor_admin_id, action FROM audit_logs WHERE entity_id = $1",
      [eventId],
    );
    expect(audit.rows).toEqual([{ actor_admin_id: adminId, action: "EVENT_UPDATED" }]);
  });

  it("prepares the clue, then queues and delivers it only on an explicit send", async () => {
    const eventId = await insertEvent("CLOSED");
    const contactId = await insertMessagingContact(pool);
    await insertGuestReservation(pool, eventId, { contactId });
    await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });
    vi.mocked(scheduleMessageDelivery).mockClear();
    authState.token = sessionToken;

    const response = await POST(clueRequest(eventId, "Mira bajo la mesa."), {
      params: Promise.resolve({ id: eventId }),
    });

    expect(response.status).toBe(201);
    const clue = await response.json();
    expect(clue).toEqual({ id: expect.any(String), message: "La pista está lista para enviar." });
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE event_id = $1", [eventId])).rows,
    ).toEqual([]);
    expect(scheduleMessageDelivery).not.toHaveBeenCalled();
    const drain = vi.spyOn(messageDelivery, "drainMessagesNow");
    expect(await sendClueToAllAction(eventId, clue.id, initialState, new FormData())).toEqual({
      ok: true,
      message: "Pista enviada a 1 invitado.",
    });
    const messages = await pool.query<{ kind: string; status: string; body: string }>(
      "SELECT kind, status, body FROM messages WHERE event_id = $1",
      [eventId],
    );
    expect(messages.rows).toEqual([{ kind: "CLUE", status: "SENT", body: "Mira bajo la mesa." }]);
    expect(drain).toHaveBeenCalledWith([expect.any(String)], { timeBudgetMs: 6_000 });
    expect(scheduleMessageDelivery).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mensajes");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mensajes/sin-enviar");
    expect(await sendClueToAllAction(eventId, clue.id, initialState, new FormData())).toEqual({
      ok: true,
      message: "Todos los invitados con pago verificado ya tienen esta pista.",
    });
  });

  it("keeps queued messages and schedules a retry if immediate delivery fails", async () => {
    const eventId = await insertEvent("CLOSED");
    await insertGuestReservation(pool, eventId, { contactId: await insertMessagingContact(pool) });
    await insertGuestReservation(pool, eventId);
    const clueId = await insertClue(eventId);
    authState.token = sessionToken;
    vi.spyOn(messageDelivery, "drainMessagesNow").mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    expect(await sendClueToAllAction(eventId, clueId, initialState, new FormData())).toEqual({
      ok: true,
      message: "Pista enviada a 2 invitados.",
    });
    const messages = await pool.query<{ status: string }>(
      "SELECT status FROM messages WHERE clue_id = $1 ORDER BY status",
      [clueId],
    );
    expect(messages.rows).toEqual([{ status: "QUEUED" }, { status: "WAITING_CONTACT" }]);
    expect(scheduleMessageDelivery).toHaveBeenCalledOnce();
  });

  it("sends to one guest explicitly and reports a repeat without duplicating messages", async () => {
    const eventId = await insertEvent("CLOSED");
    const reservationId = await insertGuestReservation(pool, eventId);
    await insertGuestReservation(pool, eventId);
    const clueId = await insertClue(eventId);
    authState.token = sessionToken;

    expect(
      await sendClueToPersonAction(eventId, clueId, reservationId, 1, initialState, new FormData()),
    ).toEqual({ ok: true, message: "Pista enviada." });
    expect(
      await sendClueToPersonAction(eventId, clueId, reservationId, 1, initialState, new FormData()),
    ).toEqual({ ok: true, message: "Esta persona ya tiene esta pista." });
    const messages = await pool.query<{ reservation_id: string }>(
      "SELECT reservation_id FROM messages WHERE clue_id = $1",
      [clueId],
    );
    expect(messages.rows).toEqual([{ reservation_id: reservationId }]);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mensajes");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mensajes/sin-enviar");
  });

  it("does not schedule any delivery when nobody is paid yet", async () => {
    const eventId = await insertEvent("CLOSED");
    vi.mocked(scheduleMessageDelivery).mockClear();
    authState.token = sessionToken;

    const response = await POST(clueRequest(eventId, "Para nadie todavía."), {
      params: Promise.resolve({ id: eventId }),
    });

    expect(response.status).toBe(201);
    expect(scheduleMessageDelivery).not.toHaveBeenCalled();
  });

  it("rejects an empty clue body", async () => {
    const eventId = await insertEvent("CLOSED");
    authState.token = sessionToken;
    const response = await POST(clueRequest(eventId, "   "), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(response.status).toBe(400);
    expect(await clueBodies(eventId)).toEqual([]);
  });

  it("refuses to publish unless the experience is closed", async () => {
    const eventId = await insertEvent("SCHEDULED");
    authState.token = sessionToken;
    const response = await POST(clueRequest(eventId, "Muy pronto"), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(response.status).toBe(409);
    expect(await clueBodies(eventId)).toEqual([]);
  });

  it("reports a missing experience", async () => {
    authState.token = sessionToken;
    const missingId = randomUUID();
    const response = await POST(clueRequest(missingId, "Pista"), {
      params: Promise.resolve({ id: missingId }),
    });
    expect(response.status).toBe(404);
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
