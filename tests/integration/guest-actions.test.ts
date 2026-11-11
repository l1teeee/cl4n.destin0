import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));
const revalidatePathMock = vi.hoisted(() => vi.fn());
const drainMessagesNowMock = vi.hoisted(() =>
  vi.fn(async (messageIds: string[]) => ({
    outcomes: Object.fromEntries(messageIds.map((id) => [id, "WAITING_CONTACT"])),
  })),
);

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/infrastructure/messaging/drain-message-outbox", () => ({
  drainMessagesNow: drainMessagesNowMock,
}));

import {
  acceptRequestAction,
  addRequestAction,
  cancelRequestAction,
  moveEntryAction,
  promoteEntryAction,
  rejectRequestAction,
  removeEntryAction,
  updateEntryAction,
} from "@/app/admin/(protected)/events/guest-actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { postgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";

import { configurePaymentSettings } from "../helpers/guest-flow-test-data";
import { resetTestDatabase } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
let pool: Pool;
let eventId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  await configurePaymentSettings(pool);
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
       opens_at, closes_at, waitlist_capacity, status, price_cents
     )
     VALUES ('Acciones', 'guest-actions', clock_timestamp() + interval '7 days', 2, 2,
             clock_timestamp() - interval '1 day', clock_timestamp() + interval '6 days', 2,
             'SCHEDULED', 2500)
     RETURNING id`,
  );
  eventId = event.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

function guestForm(name = "Ana Acción", instagram = "@ana.accion"): FormData {
  const formData = new FormData();
  formData.set("partySize", "1");
  formData.set("guestName", name);
  formData.set("guestInstagram", instagram);
  formData.set("hasAllergies", "false");
  formData.set("notes", "");
  return formData;
}

async function insertEvent(
  slug: string,
  capacity: number,
  waitlistCapacity: number,
): Promise<string> {
  const event = await pool.query<{ id: string }>(
    `INSERT INTO events (
       internal_name, slug, starts_at, capacity, max_party_size,
       opens_at, closes_at, waitlist_capacity, status, price_cents
     )
     VALUES ($1, $1, clock_timestamp() + interval '7 days', $2, 2,
             clock_timestamp() - interval '1 day', clock_timestamp() + interval '6 days', $3,
             'SCHEDULED', 2500)
     RETURNING id`,
    [slug, capacity, waitlistCapacity],
  );
  return event.rows[0]!.id;
}

async function reservationIdOf(forEventId: string, handle: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM reservations WHERE event_id = $1 AND instagram_handle = $2",
    [forEventId, handle],
  );
  return result.rows[0]!.id;
}

async function entryIdOf(forEventId: string, handle: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM waitlist_entries WHERE event_id = $1 AND instagram_handle = $2",
    [forEventId, handle],
  );
  return result.rows[0]!.id;
}

// Ada and Dan fill the two seats, the couple Eva heads the queue and Gus waits behind her.
// Rejecting Ada frees one seat that the couple cannot use, so nobody is promoted yet and Gus
// only gets in when the couple is removed, edited down to one person, or moved behind him.
async function seedQueueBlockedByCouple(slug: string) {
  const blockedEventId = await insertEvent(slug, 2, 3);
  await addRequestAction(blockedEventId, initialState, guestForm("Ada Cola", "@ada.cola"));
  await addRequestAction(blockedEventId, initialState, guestForm("Dan Cola", "@dan.cola"));
  const couple = guestForm("Eva Pareja", "@eva.pareja");
  couple.set("partySize", "2");
  couple.append("guestName", "Eva Dos");
  couple.append("guestInstagram", "@eva.dos");
  await addRequestAction(blockedEventId, initialState, couple);
  await addRequestAction(blockedEventId, initialState, guestForm("Gus Cola", "@gus.cola"));

  const rejected = await rejectRequestAction(
    await reservationIdOf(blockedEventId, "ada.cola"),
    initialState,
    new FormData(),
  );
  expect(rejected).toMatchObject({ ok: true });
  return {
    eventId: blockedEventId,
    coupleEntryId: await entryIdOf(blockedEventId, "eva.pareja"),
    gusEntryId: await entryIdOf(blockedEventId, "gus.cola"),
  };
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

  it("accepts anyway and says so when the payment data or the price is missing", async () => {
    const lenientEventId = await insertEvent("accept-lenient", 2, 0);
    await addRequestAction(lenientEventId, initialState, guestForm("Gabi Guarda", "@gabi.guarda"));
    await addRequestAction(lenientEventId, initialState, guestForm("Hugo Guarda", "@hugo.guarda"));
    const noPrice = await reservationIdOf(lenientEventId, "gabi.guarda");
    const noSettings = await reservationIdOf(lenientEventId, "hugo.guarda");
    const warning = " Faltan datos de pago: el mensaje salió sin ellos.";

    await pool.query("UPDATE events SET price_cents = NULL WHERE id = $1", [lenientEventId]);
    const withoutPrice = await acceptRequestAction(noPrice, initialState, new FormData());
    expect(withoutPrice).toMatchObject({ ok: true });
    expect(withoutPrice.message.endsWith(warning)).toBe(true);

    await pool.query("UPDATE events SET price_cents = 2500 WHERE id = $1", [lenientEventId]);
    await pool.query("DELETE FROM payment_settings");
    try {
      const withoutSettings = await acceptRequestAction(noSettings, initialState, new FormData());
      expect(withoutSettings).toMatchObject({ ok: true });
      expect(withoutSettings.message.endsWith(warning)).toBe(true);
    } finally {
      await configurePaymentSettings(pool);
    }

    const stored = await pool.query<{ stage: string }>(
      "SELECT stage FROM reservations WHERE id = ANY($1::uuid[])",
      [[noPrice, noSettings]],
    );
    expect(stored.rows.map((row) => row.stage)).toEqual(["ON_LIST", "ON_LIST"]);
    const messages = await pool.query<{ body: string }>(
      `SELECT body FROM messages WHERE reservation_id = $1 AND kind = 'ON_LIST'`,
      [noSettings],
    );
    expect(messages.rows).toHaveLength(1);
    expect(messages.rows[0]!.body).toContain("$25.00");
  });

  it("does not warn when the payment data and the price are set", async () => {
    const readyEventId = await insertEvent("accept-ready", 2, 0);
    await addRequestAction(readyEventId, initialState, guestForm("Rita Lista", "@rita.lista"));

    const accepted = await acceptRequestAction(
      await reservationIdOf(readyEventId, "rita.lista"),
      initialState,
      new FormData(),
    );

    expect(accepted).toMatchObject({ ok: true });
    expect(accepted.message).not.toContain("Faltan datos de pago");
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

  it("requires the stage seen by the admin before cancelling", async () => {
    const reservation = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE event_id = $1 ORDER BY created_at LIMIT 1",
      [eventId],
    );
    const result = await cancelRequestAction(reservation.rows[0]!.id, initialState, new FormData());

    expect(result).toMatchObject({ ok: false, message: "Revisa los campos marcados." });
    await expect(
      pool.query("SELECT status, stage FROM reservations WHERE id = $1", [reservation.rows[0]!.id]),
    ).resolves.toMatchObject({ rows: [{ status: "CONFIRMED", stage: "ON_LIST" }] });
  });

  it("cancels only the stage the admin saw", async () => {
    const stageEventId = await insertEvent("guest-actions-stage", 2, 0);
    await addRequestAction(stageEventId, initialState, guestForm("Hana Etapa", "@hana.etapa"));
    const reservationId = await reservationIdOf(stageEventId, "hana.etapa");
    await acceptRequestAction(reservationId, initialState, new FormData());

    const paidStage = new FormData();
    paidStage.set("expectedStage", "PAID");
    expect(await cancelRequestAction(reservationId, initialState, paidStage)).toMatchObject({
      ok: false,
      message: "La solicitud ya cambió de estado. Recarga la página.",
    });
    await expect(
      pool.query("SELECT status, stage FROM reservations WHERE id = $1", [reservationId]),
    ).resolves.toMatchObject({ rows: [{ status: "CONFIRMED", stage: "ON_LIST" }] });

    const onListStage = new FormData();
    onListStage.set("expectedStage", "ON_LIST");
    expect(await cancelRequestAction(reservationId, initialState, onListStage)).toMatchObject({
      ok: true,
    });
    await expect(
      pool.query("SELECT status, refund_status FROM reservations WHERE id = $1", [reservationId]),
    ).resolves.toMatchObject({ rows: [{ status: "CANCELLED", refund_status: null }] });
  });

  it("tells who entered the list when removing a queue head that did not fit", async () => {
    const queue = await seedQueueBlockedByCouple("guest-actions-remove");

    const removed = await removeEntryAction(queue.coupleEntryId, initialState, new FormData());

    expect(removed).toEqual({
      ok: true,
      message: "Se quitó a Eva Pareja y Eva Dos de la cola. Entró Gus Cola desde la cola.",
    });
  });

  it("tells who entered the list and delivers their message when a move changes the head", async () => {
    const queue = await seedQueueBlockedByCouple("guest-actions-move");
    drainMessagesNowMock.mockClear();
    const direction = new FormData();
    direction.set("direction", "UP");

    const moved = await moveEntryAction(queue.gusEntryId, initialState, direction);

    expect(moved).toEqual({
      ok: true,
      message: "Moviste a Gus Cola en la cola. Entró Gus Cola desde la cola.",
    });
    const promotedMessage = await pool.query<{ id: string }>(
      `SELECT m.id
         FROM messages m
         JOIN reservations r ON r.id = m.reservation_id
        WHERE r.event_id = $1 AND m.kind = 'PROMOTED'`,
      [queue.eventId],
    );
    expect(drainMessagesNowMock).toHaveBeenCalledWith([promotedMessage.rows[0]!.id], {
      timeBudgetMs: 6_000,
    });
  });

  it("tells who entered the list when editing the queue head down to a size that fits", async () => {
    const queue = await seedQueueBlockedByCouple("guest-actions-edit");

    const edited = await updateEntryAction(
      queue.coupleEntryId,
      initialState,
      guestForm("Eva Sola", "@eva.pareja"),
    );

    expect(edited).toEqual({
      ok: true,
      message: "Actualizaste a Eva Sola en la cola. Entró Eva Sola desde la cola.",
    });
  });

  it("maps retryable database failures to the busy response", async () => {
    const failure = Object.assign(new Error("lock timeout"), { code: "55P03" });
    const spy = vi.spyOn(postgresGuestAdminRepository, "accept").mockRejectedValueOnce(failure);

    const result = await acceptRequestAction(
      "00000000-0000-4000-8000-000000000001",
      initialState,
      new FormData(),
    );

    expect(result).toEqual({
      ok: false,
      message: "La experiencia está muy ocupada. Intenta de nuevo en unos segundos.",
    });
    spy.mockRestore();
  });

  it("revalidates a committed change when immediate delivery fails", async () => {
    const added = await addRequestAction(
      eventId,
      initialState,
      guestForm("Bea Acción", "@bea.accion"),
    );
    expect(added.ok).toBe(true);
    const reservation = await pool.query<{ id: string }>(
      "SELECT id FROM reservations WHERE event_id = $1 AND instagram_handle = 'bea.accion'",
      [eventId],
    );
    drainMessagesNowMock.mockRejectedValueOnce(new Error("Instagram unavailable"));
    revalidatePathMock.mockClear();

    const accepted = await acceptRequestAction(
      reservation.rows[0]!.id,
      initialState,
      new FormData(),
    );

    expect(accepted).toMatchObject({ ok: true });
    expect(accepted.message).toContain("El mensaje se está enviando.");
    expect(revalidatePathMock).toHaveBeenCalledWith(`/admin/events/${eventId}`);
    await expect(
      pool.query("SELECT stage FROM reservations WHERE id = $1", [reservation.rows[0]!.id]),
    ).resolves.toMatchObject({ rows: [{ stage: "ON_LIST" }] });
  });

  it("reports an override duplicate as a general error", async () => {
    const spy = vi.spyOn(postgresGuestAdminRepository, "promoteEntry").mockResolvedValueOnce({
      ok: false,
      code: "DUPLICATE_HANDLE",
    });

    const result = await promoteEntryAction(
      "00000000-0000-4000-8000-000000000002",
      initialState,
      new FormData(),
    );

    expect(result).toMatchObject({
      ok: false,
      message: "Ya existe una solicitud activa con ese usuario de Instagram.",
    });
    expect(result.fieldErrors).toBeUndefined();
    spy.mockRestore();
  });

  it("shows the event maximum when an admin party is too large", async () => {
    await pool.query("UPDATE events SET max_party_size = 1 WHERE id = $1", [eventId]);
    const formData = guestForm("Pareja Acción", "@pareja.accion");
    formData.set("partySize", "2");
    formData.append("guestName", "Pareja Dos");
    formData.append("guestInstagram", "@pareja.dos");

    const result = await addRequestAction(eventId, initialState, formData);

    expect(result).toEqual({ ok: false, message: "Máximo 1 personas por solicitud." });
  });
});
