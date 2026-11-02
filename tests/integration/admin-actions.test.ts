import { Pool } from "pg";
import { redirect } from "next/navigation";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));

const scheduleEmailDeliveryMock = vi.hoisted(() => vi.fn());
const scheduleMessageDeliveryMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/email/outbox/schedule-email-delivery", () => ({
  scheduleEmailDelivery: scheduleEmailDeliveryMock,
}));
vi.mock("@/infrastructure/messaging/schedule-message-delivery", () => ({
  scheduleMessageDelivery: scheduleMessageDeliveryMock,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import { signOutAction } from "@/app/admin/(protected)/actions";
import {
  cancelEventAction,
  changeCapacityAction,
  changeWaitlistCapacityAction,
  closeEventNowAction,
  completeEventAction,
  createEventAction,
  deleteEventAction,
  deleteEventImageAction,
  openEventNowAction,
  publishEventAction,
  setEventLocationStatusAction,
  updateEventAction,
} from "@/app/admin/(protected)/events/actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
let pool: Pool;
let adminId: string;
let sessionToken: string;

beforeEach(async () => {
  scheduleEmailDeliveryMock.mockClear();
  scheduleMessageDeliveryMock.mockClear();
  authState.token = undefined;
  if (pool) await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('actions@example.com', 'actions@example.com', 'hash', 'Admin Actions')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
  sessionToken = (await postgresAdminAuthRepository.createSession(adminId, "hash", null))!.token;
});

afterAll(async () => {
  if (pool) await pool.end();
});

function createForm(slug = "cena-admin"): FormData {
  const form = new FormData();
  form.set("internalName", "Cena administrativa");
  form.set("slug", slug);
  form.set("eventDate", "2098-11-20");
  form.set("eventTime", "19:30");
  form.set("opensAt", "2098-11-01T08:00");
  form.set("closesAt", "2098-11-19T20:00");
  form.set("capacity", "20");
  form.set("maxPartySize", "2");
  form.set("waitlistCapacity", "5");
  form.set("price", "25.00");
  form.set("status", "DRAFT");
  form.set("locationStatus", "PENDING");
  return form;
}

function updateForm(slug: string, name = "Cena actualizada"): FormData {
  const form = new FormData();
  form.set("internalName", name);
  form.set("slug", slug);
  form.set("eventDate", "2098-11-21");
  form.set("eventTime", "20:00");
  form.set("opensAt", "2098-11-01T08:00");
  form.set("closesAt", "2098-11-20T20:00");
  form.set("maxPartySize", "2");
  form.set("locationStatus", "PENDING");
  form.set("locationRevision", "0");
  form.set("locationStatusLoaded", "PENDING");
  return form;
}

async function insertEvent(status: "DRAFT" | "SCHEDULED" | "CLOSED", slug: string) {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       internal_name, slug, starts_at, capacity, max_party_size,
       opens_at, closes_at, auto_close_on_full, status
     ) VALUES ($1, $2, '2098-11-21T01:30:00Z', 20, 2,
       '2098-11-01T14:00:00Z', '2098-11-21T02:00:00Z', false, $3)
     RETURNING id`,
    ["Cena", slug, status],
  );
  return result.rows[0]!.id;
}

async function statusOf(id: string): Promise<string> {
  const result = await pool.query<{ status: string }>("SELECT status FROM events WHERE id = $1", [
    id,
  ]);
  return result.rows[0]!.status;
}

async function authorize(): Promise<void> {
  authState.token = sessionToken;
}

describe("admin event Server Actions", () => {
  it("does not delete another session when sign-out has no session", async () => {
    const before = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM admin_sessions",
    );

    await expect(signOutAction()).rejects.toThrow("REDIRECT:/admin/login");

    const after = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM admin_sessions",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("protects and performs create", async () => {
    expect(await createEventAction(initialState, createForm())).toMatchObject({ ok: false });
    expect((await pool.query("SELECT 1 FROM events")).rowCount).toBe(0);
    await authorize();
    await expect(createEventAction(initialState, createForm())).rejects.toThrow(
      /^REDIRECT:\/admin\/events\//,
    );
    const created = await pool.query<{ id: string }>("SELECT id FROM events");
    expect(created.rowCount).toBe(1);
    expect(redirect).toHaveBeenLastCalledWith(`/admin/events/${created.rows[0]!.id}`);
  });

  describe("schedule rules against the database clock", () => {
    async function databaseNow(): Promise<Date> {
      const result = await pool.query<{ now: Date }>("SELECT clock_timestamp() AS now");
      return result.rows[0]!.now;
    }

    function localMinute(date: Date): string {
      return formatUtcForElSalvador(date, "yyyy-MM-dd'T'HH:mm");
    }

    async function createWith(fields: Record<string, string>) {
      const form = createForm();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      return createEventAction(initialState, form);
    }

    it("rejects an opening that already passed and creates nothing", async () => {
      await authorize();

      const result = await createWith({ opensAt: "2020-01-01T08:00" });

      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { opensAt: "La apertura ya pasó. Usa una hora actual o 'Abrir ahora'." },
      });
      expect((await pool.query("SELECT 1 FROM events")).rowCount).toBe(0);
    });

    it("requires the closing to be before the dinner", async () => {
      await authorize();

      const result = await createWith({ closesAt: "2098-11-21T08:00" });

      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { closesAt: "El cierre debe ser antes de la cena." },
      });
    });

    it("judges the schedule by the database clock, not the application clock", async () => {
      await authorize();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
      try {
        const result = await createWith({ opensAt: "2020-01-01T08:00" });

        expect(result).toMatchObject({
          ok: false,
          fieldErrors: { opensAt: expect.stringContaining("La apertura ya pasó") },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("accepts an opening seconds in the past and rejects one five minutes in the past", async () => {
      await authorize();
      const now = await databaseNow();

      const recent = createWith({ opensAt: localMinute(new Date(now.getTime() - 30_000)) });
      await expect(recent).rejects.toThrow(/^REDIRECT:/);

      const stale = await createWith({
        slug: "cena-tardia",
        opensAt: localMinute(new Date(now.getTime() - 5 * 60_000)),
      });
      expect(stale).toMatchObject({ ok: false, fieldErrors: { opensAt: expect.any(String) } });
    });

    it("requires the dinner to be in the future", async () => {
      await authorize();

      const result = await createWith({
        eventDate: "2020-01-02",
        opensAt: localMinute(await databaseNow()),
        closesAt: "2020-01-02T09:00",
      });

      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { eventDate: "La fecha de la cena debe ser futura." },
      });
    });

    it("opens at the database time and ignores the typed opening when asked to open now", async () => {
      await authorize();
      const before = await databaseNow();

      await expect(createWith({ opensAt: "2020-01-01T08:00", openNow: "1" })).rejects.toThrow(
        /^REDIRECT:/,
      );

      const after = await databaseNow();
      const stored = await pool.query<{ opens_at: Date }>("SELECT opens_at FROM events");
      expect(stored.rows[0]!.opens_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(stored.rows[0]!.opens_at.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("requires the price on create and stores it in cents", async () => {
      await authorize();

      expect(await createWith({ price: "" })).toMatchObject({
        ok: false,
        fieldErrors: { price: "El precio por persona es obligatorio." },
      });
      await expect(
        createWith({ price: "12.50", paymentInstructions: "Paga antes" }),
      ).rejects.toThrow(/^REDIRECT:/);
      const stored = await pool.query<{ price_cents: number; payment_instructions: string }>(
        "SELECT price_cents, payment_instructions FROM events",
      );
      expect(stored.rows).toEqual([{ price_cents: 1250, payment_instructions: "Paga antes" }]);
    });

    it("does not recheck an unchanged opening on update, even when it is in the past", async () => {
      await authorize();
      const id = await insertEvent("DRAFT", "past-opening");
      await pool.query(
        "UPDATE events SET opens_at = '2020-01-01T14:00:00Z', starts_at = '2098-11-21T01:30:00Z' WHERE id = $1",
        [id],
      );
      const form = updateForm("past-opening");
      form.set("opensAt", "2020-01-01T08:00");

      expect(await updateEventAction(id, initialState, form)).toMatchObject({ ok: true });
    });

    it("edits other fields of a closed event whose dinner already passed", async () => {
      await authorize();
      const id = await insertEvent("CLOSED", "past-dinner");
      await pool.query(
        `UPDATE events
            SET starts_at = '2020-02-01T02:00:00Z', opens_at = '2020-01-01T14:00:00Z',
                closes_at = '2020-02-01T01:00:00Z'
          WHERE id = $1`,
        [id],
      );
      const form = updateForm("past-dinner", "Nombre corregido");
      form.set("eventDate", "2020-01-31");
      form.set("eventTime", "20:00");
      form.set("opensAt", "2020-01-01T08:00");
      form.set("closesAt", "2020-01-31T19:00");

      expect(await updateEventAction(id, initialState, form)).toMatchObject({ ok: true });

      const moved = updateForm("past-dinner");
      moved.set("eventDate", "2020-01-30");
      moved.set("eventTime", "20:00");
      moved.set("opensAt", "2020-01-01T08:00");
      moved.set("closesAt", "2020-01-30T19:00");
      expect(await updateEventAction(id, initialState, moved)).toMatchObject({
        ok: false,
        fieldErrors: { eventDate: "La fecha de la cena debe ser futura." },
      });
      const stored = await pool.query<{ internal_name: string }>(
        "SELECT internal_name FROM events WHERE id = $1",
        [id],
      );
      expect(stored.rows[0]!.internal_name).toBe("Nombre corregido");
    });

    it("rejects a changed opening in the past on update", async () => {
      await authorize();
      const id = await insertEvent("SCHEDULED", "changed-opening");
      const form = updateForm("changed-opening");
      form.set("opensAt", "2020-01-01T08:00");

      expect(await updateEventAction(id, initialState, form)).toMatchObject({
        ok: false,
        fieldErrors: { opensAt: expect.stringContaining("La apertura ya pasó") },
      });
    });

    it("sets the opening to the database time when updating with openNow", async () => {
      await authorize();
      const id = await insertEvent("DRAFT", "update-open-now");
      const before = await databaseNow();
      const form = updateForm("update-open-now");
      form.set("openNow", "1");

      expect(await updateEventAction(id, initialState, form)).toMatchObject({ ok: true });

      const stored = await pool.query<{ opens_at: Date }>(
        "SELECT opens_at FROM events WHERE id = $1",
        [id],
      );
      expect(stored.rows[0]!.opens_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("sets the price on an event that had none and keeps it when the field is empty", async () => {
      await authorize();
      const id = await insertEvent("DRAFT", "update-price");
      const priced = updateForm("update-price");
      priced.set("price", "30");
      expect(await updateEventAction(id, initialState, priced)).toMatchObject({ ok: true });

      const keeping = updateForm("update-price");
      keeping.set("price", "");
      expect(await updateEventAction(id, initialState, keeping)).toMatchObject({ ok: true });

      const stored = await pool.query<{ price_cents: number }>(
        "SELECT price_cents FROM events WHERE id = $1",
        [id],
      );
      expect(stored.rows[0]!.price_cents).toBe(3000);
    });
  });

  it("protects and performs update", async () => {
    const id = await insertEvent("DRAFT", "update-event");
    expect(await updateEventAction(id, initialState, updateForm("update-event"))).toMatchObject({
      ok: false,
    });
    expect(
      (
        await pool.query<{ internal_name: string }>(
          "SELECT internal_name FROM events WHERE id = $1",
          [id],
        )
      ).rows[0]!.internal_name,
    ).toBe("Cena");
    await authorize();
    expect(await updateEventAction(id, initialState, updateForm("update-event"))).toMatchObject({
      ok: true,
    });
    expect(
      (
        await pool.query<{ internal_name: string }>(
          "SELECT internal_name FROM events WHERE id = $1",
          [id],
        )
      ).rows[0]!.internal_name,
    ).toBe("Cena actualizada");
  });

  it("protects and performs the location status quick action", async () => {
    const id = await insertEvent("DRAFT", "location-status-event");
    await pool.query("UPDATE events SET location_address = 'San Salvador' WHERE id = $1", [id]);
    expect(
      await setEventLocationStatusAction(
        id,
        "CONFIRMED",
        { revision: 0, status: "PENDING" },
        initialState,
        new FormData(),
      ),
    ).toMatchObject({ ok: false });
    await authorize();
    expect(
      await setEventLocationStatusAction(
        id,
        "CONFIRMED",
        { revision: 0, status: "PENDING" },
        initialState,
        new FormData(),
      ),
    ).toMatchObject({ ok: true });
    await expect(
      pool.query("SELECT location_status, location_confirmed_at FROM events WHERE id = $1", [id]),
    ).resolves.toMatchObject({
      rows: [{ location_status: "CONFIRMED", location_confirmed_at: expect.any(Date) }],
    });
  });

  it("protects and performs image deletion", async () => {
    const id = await insertEvent("DRAFT", "delete-image-event");
    const image = await pool.query<{ id: string }>(
      `INSERT INTO event_images (
         event_id, content_type, byte_size, data, public_token, created_by
       ) VALUES ($1, 'image/webp', 1, $2, $3, $4) RETURNING id`,
      [id, Buffer.from([1]), "a".repeat(43), adminId],
    );
    const imageId = image.rows[0]!.id;
    expect(await deleteEventImageAction(id, imageId, initialState, new FormData())).toMatchObject({
      ok: false,
    });
    await authorize();
    expect(await deleteEventImageAction(id, imageId, initialState, new FormData())).toMatchObject({
      ok: true,
    });
    expect((await pool.query("SELECT 1 FROM event_images WHERE id = $1", [imageId])).rowCount).toBe(
      0,
    );
  });

  it("protects and performs publish", async () => {
    const id = await insertEvent("DRAFT", "publish-event");
    expect(await publishEventAction(id, initialState, new FormData())).toMatchObject({ ok: false });
    expect(await statusOf(id)).toBe("DRAFT");
    await authorize();
    expect(await publishEventAction(id, initialState, new FormData())).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("SCHEDULED");
  });

  it("protects and performs open now", async () => {
    const id = await insertEvent("DRAFT", "open-event");
    expect(await openEventNowAction(id, initialState, new FormData())).toMatchObject({ ok: false });
    expect(await statusOf(id)).toBe("DRAFT");
    await authorize();
    expect(await openEventNowAction(id, initialState, new FormData())).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("SCHEDULED");
  });

  it("protects and performs close now", async () => {
    const id = await insertEvent("SCHEDULED", "close-event");
    expect(await closeEventNowAction(id, initialState, new FormData())).toMatchObject({
      ok: false,
    });
    expect(await statusOf(id)).toBe("SCHEDULED");
    await authorize();
    expect(await closeEventNowAction(id, initialState, new FormData())).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("CLOSED");
  });

  it("protects and performs complete", async () => {
    const id = await insertEvent("CLOSED", "complete-event");
    expect(await completeEventAction(id, initialState, new FormData())).toMatchObject({
      ok: false,
    });
    expect(await statusOf(id)).toBe("CLOSED");
    await authorize();
    expect(await completeEventAction(id, initialState, new FormData())).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("COMPLETED");
  });

  it("protects and performs event cancellation", async () => {
    const id = await insertEvent("DRAFT", "cancel-event");
    expect(await cancelEventAction(id, initialState, new FormData())).toMatchObject({ ok: false });
    expect(await statusOf(id)).toBe("DRAFT");
    await authorize();
    expect(await cancelEventAction(id, initialState, new FormData())).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("CANCELLED");
  });

  it("protects and performs event deletion", async () => {
    const id = await insertEvent("DRAFT", "delete-event");
    expect(await deleteEventAction(id, initialState, new FormData())).toMatchObject({ ok: false });
    await expect(
      pool.query("SELECT deleted_at FROM events WHERE id = $1", [id]),
    ).resolves.toMatchObject({ rows: [{ deleted_at: null }] });

    await authorize();
    expect(await deleteEventAction(id, initialState, new FormData())).toMatchObject({
      ok: true,
      message: "Experiencia eliminada.",
    });
    await expect(
      pool.query("SELECT deleted_at FROM events WHERE id = $1", [id]),
    ).resolves.toMatchObject({ rows: [{ deleted_at: expect.any(Date) }] });
  });

  it("protects and performs capacity changes", async () => {
    const id = await insertEvent("DRAFT", "capacity-event");
    const form = new FormData();
    form.set("newCapacity", "25");
    expect(await changeCapacityAction(id, initialState, form)).toMatchObject({ ok: false });
    expect(scheduleEmailDeliveryMock).not.toHaveBeenCalled();
    expect(scheduleMessageDeliveryMock).not.toHaveBeenCalled();
    expect(
      (await pool.query<{ capacity: number }>("SELECT capacity FROM events WHERE id = $1", [id]))
        .rows[0]!.capacity,
    ).toBe(20);
    await authorize();
    expect(await changeCapacityAction(id, initialState, form)).toMatchObject({ ok: true });
    expect(scheduleEmailDeliveryMock).toHaveBeenCalledOnce();
    expect(scheduleMessageDeliveryMock).toHaveBeenCalledOnce();
    expect(
      (await pool.query<{ capacity: number }>("SELECT capacity FROM events WHERE id = $1", [id]))
        .rows[0]!.capacity,
    ).toBe(25);
  });

  it("protects and performs waitlist capacity changes", async () => {
    const id = await insertEvent("DRAFT", "waitlist-capacity-event");
    const form = new FormData();
    form.set("waitlistCapacity", "7");

    expect(await changeWaitlistCapacityAction(id, initialState, form)).toMatchObject({ ok: false });
    await authorize();
    expect(await changeWaitlistCapacityAction(id, initialState, form)).toMatchObject({ ok: true });
    expect(
      (
        await pool.query<{ waitlist_capacity: number }>(
          "SELECT waitlist_capacity FROM events WHERE id = $1",
          [id],
        )
      ).rows[0]!.waitlist_capacity,
    ).toBe(7);
  });

  it("rejects a missing or empty waitlist capacity instead of reading it as 0", async () => {
    const id = await insertEvent("DRAFT", "waitlist-capacity-missing");
    await authorize();

    const empty = new FormData();
    empty.set("waitlistCapacity", "");
    expect(await changeWaitlistCapacityAction(id, initialState, empty)).toMatchObject({
      ok: false,
      message: "Los lugares en cola deben ser un número.",
    });
    expect(await changeWaitlistCapacityAction(id, initialState, new FormData())).toMatchObject({
      ok: false,
    });
  });
});
