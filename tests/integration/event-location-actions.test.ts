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
vi.mock("@/infrastructure/messaging/drain-message-outbox", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infrastructure/messaging/drain-message-outbox")>();
  return { ...actual, drainMessagesNow: vi.fn(actual.drainMessagesNow) };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import { sendEventLocationAction } from "@/app/admin/(protected)/events/actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { drainMessagesNow } from "@/infrastructure/messaging/drain-message-outbox";
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

  it("does not say everybody has it when earlier messages are still pending", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId, {
      contactId: await insertMessagingContact(pool, new Date(Date.now() - 30 * 60 * 60 * 1000)),
    });
    authState.token = sessionToken;

    await sendLocation(eventId);
    const second = await sendLocation(eventId);

    expect(second).toEqual({
      ok: true,
      message:
        "Nadie más necesita el envío. 1 persona sigue pendiente de recibir la ubicación; revísalo en Mensajes.",
    });
  });

  it("keeps the committed send and reports it as queued when the immediate delivery throws", async () => {
    const eventId = await insertLocationEvent(pool);
    for (let index = 0; index < 3; index += 1) {
      await insertGuestReservation(pool, eventId, {
        contactId: await insertMessagingContact(pool),
      });
    }
    authState.token = sessionToken;
    vi.mocked(drainMessagesNow).mockRejectedValueOnce(new Error("instagram unreachable"));
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      expect(await sendLocation(eventId)).toEqual({
        ok: true,
        message: "Ubicación en cola para 3 personas; se enviará en unos minutos.",
      });

      const entries = logged.mock.calls.map((call) => JSON.parse(String(call[0])));
      expect(entries).toEqual([
        expect.objectContaining({
          level: "error",
          msg: "location_immediate_delivery_failed",
          messageCount: 3,
        }),
      ]);
      expect(JSON.stringify(entries)).not.toContain("instagram unreachable");
    } finally {
      logged.mockRestore();
    }
    expect(await listLocationMessages(pool, eventId)).toHaveLength(3);
    expect(scheduleMessageDelivery).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/events/${eventId}`);
  });

  it("refuses to send for a cancelled experience", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId);
    await pool.query("UPDATE events SET status = 'CANCELLED' WHERE id = $1", [eventId]);
    authState.token = sessionToken;

    expect(await sendLocation(eventId)).toEqual({
      ok: false,
      message: "La experiencia ya no admite envíos.",
    });
    expect(await listLocationMessages(pool, eventId)).toEqual([]);
  });

  it("rejects a malformed location version before touching the database", async () => {
    const eventId = await insertLocationEvent(pool);
    await insertGuestReservation(pool, eventId);
    authState.token = sessionToken;

    expect(await sendLocation(eventId, { revision: -1, status: "CONFIRMED" })).toEqual({
      ok: false,
      message: "La versión de la ubicación no es válida.",
    });
    expect(
      await sendEventLocationAction(
        eventId,
        { revision: 0, status: "BOGUS" } as unknown as typeof loaded,
        initialState,
        new FormData(),
      ),
    ).toEqual({ ok: false, message: "La versión de la ubicación no es válida." });
    expect(await listLocationMessages(pool, eventId)).toEqual([]);
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
