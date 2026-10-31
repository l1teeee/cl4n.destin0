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

import { sendEventLocationAction } from "@/app/admin/(protected)/events/actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { scheduleMessageDelivery } from "@/infrastructure/messaging/schedule-message-delivery";

import {
  insertAdminUser,
  insertGuestReservation,
  insertLocationEvent,
  insertMessagingContact,
  listLocationMessages,
} from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
const loaded = { revision: 0, status: "CONFIRMED" as const };
let pool: Pool;
let sessionToken: string;

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(scheduleMessageDelivery).mockClear();
  authState.token = undefined;
  if (pool) await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  const adminId = await insertAdminUser(pool, "Admin Ubicación");
  sessionToken = (await postgresAdminAuthRepository.createSession(adminId, "hash", null))!.token;
});

afterAll(async () => {
  if (pool) await pool.end();
});

function sendLocation(
  eventId: string,
  version: typeof loaded | { revision: number; status: "PENDING" } = loaded,
) {
  return sendEventLocationAction(eventId, version, initialState, new FormData());
}

describe("sendEventLocationAction", () => {
  it("rejects a request without an admin session and queues nothing", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId);

    expect(await sendLocation(eventId)).toEqual({
      ok: false,
      message: "Tu sesión no es válida. Inicia sesión nuevamente.",
    });
    expect(await listLocationMessages(pool, eventId)).toEqual([]);
  });

  it("queues, delivers right away and reports who received the location and who is pending", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId, { contactId: await insertMessagingContact(pool) });
    await insertGuestReservation(pool, eventId, {
      contactId: await insertMessagingContact(pool, new Date(Date.now() - 30 * 60 * 60 * 1000)),
    });
    await insertGuestReservation(pool, eventId);
    authState.token = sessionToken;

    const result = await sendLocation(eventId);

    expect(result).toEqual({
      ok: true,
      message:
        "Ubicación enviada a 1 persona. 1 quedó pendiente porque no nos ha escrito en las últimas 24 horas. 1 quedó pendiente porque aún no vinculamos su conversación de Instagram.",
    });
    const rows = await listLocationMessages(pool, eventId);
    expect(rows.map((row) => row.status).sort()).toEqual([
      "SENT",
      "WAITING_CONTACT",
      "WAITING_WINDOW",
    ]);
    expect(scheduleMessageDelivery).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mensajes");
  });

  it("says that everybody already has the location on a second send", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId, { contactId: await insertMessagingContact(pool) });
    authState.token = sessionToken;

    await sendLocation(eventId);
    const second = await sendLocation(eventId);

    expect(second).toEqual({
      ok: true,
      message: "Todas las personas confirmadas ya tienen la ubicación actual.",
    });
    expect(await listLocationMessages(pool, eventId)).toHaveLength(1);
  });

  it("asks to reload when the location changed after the page was loaded", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId);
    authState.token = sessionToken;

    expect(await sendLocation(eventId, { revision: 5, status: "CONFIRMED" })).toEqual({
      ok: false,
      message:
        "La ubicación cambió mientras editabas. Recarga la página para ver la versión actual.",
    });
    expect(await listLocationMessages(pool, eventId)).toEqual([]);
  });

  it("asks to confirm the location first", async () => {
    const eventId = await insertLocationEvent(pool, { confirmed: false });
    authState.token = sessionToken;

    expect(await sendLocation(eventId, { revision: 0, status: "PENDING" })).toEqual({
      ok: false,
      message: "Confirma la ubicación antes de enviarla.",
    });
  });

  it("shows the too-long message and queues nothing", async () => {
    const eventId = await insertLocationEvent(pool, {
      notes: "n".repeat(1000),
      mapsUrl: `https://maps.google.com/?q=${"a".repeat(1100)}`,
    });
    await insertGuestReservation(pool, eventId);
    authState.token = sessionToken;

    expect(await sendLocation(eventId)).toEqual({
      ok: false,
      message:
        "La ubicación es demasiado larga para un mensaje de Instagram. Acorta las indicaciones o el enlace.",
    });
    expect(await listLocationMessages(pool, eventId)).toEqual([]);
    expect(scheduleMessageDelivery).not.toHaveBeenCalled();
  });

  it("rejects an invalid event id", async () => {
    authState.token = sessionToken;

    expect(await sendLocation("not-a-uuid")).toEqual({
      ok: false,
      message: "El identificador no es válido.",
    });
  });
});
