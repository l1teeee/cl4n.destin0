import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));

const scheduleEmailDeliveryMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/email/outbox/schedule-email-delivery", () => ({
  scheduleEmailDelivery: scheduleEmailDeliveryMock,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import { signOutAction } from "@/app/admin/(protected)/actions";
import {
  cancelEventAction,
  cancelReservationAction,
  cancelWaitlistEntryAction,
  changeCapacityAction,
  closeEventNowAction,
  completeEventAction,
  createEventAction,
  deleteEventImageAction,
  openEventNowAction,
  publishEventAction,
  setEventLocationStatusAction,
  updateEventAction,
} from "@/app/admin/(protected)/events/actions";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
let pool: Pool;
let adminId: string;
let sessionToken: string;

beforeEach(async () => {
  scheduleEmailDeliveryMock.mockClear();
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
  form.set("eventDate", "2027-11-20");
  form.set("eventTime", "19:30");
  form.set("opensAt", "2027-11-01T08:00");
  form.set("closesAt", "2027-11-19T20:00");
  form.set("capacity", "20");
  form.set("maxPartySize", "4");
  form.set("status", "DRAFT");
  form.set("locationStatus", "PENDING");
  return form;
}

function updateForm(slug: string, name = "Cena actualizada"): FormData {
  const form = new FormData();
  form.set("internalName", name);
  form.set("slug", slug);
  form.set("eventDate", "2027-11-21");
  form.set("eventTime", "20:00");
  form.set("opensAt", "2027-11-01T08:00");
  form.set("closesAt", "2027-11-20T20:00");
  form.set("maxPartySize", "5");
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
     ) VALUES ($1, $2, '2027-11-21T01:30:00Z', 20, 4,
       '2027-11-01T14:00:00Z', '2027-11-21T02:00:00Z', false, $3)
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
    expect(await createEventAction(initialState, createForm())).toMatchObject({ ok: true });
    expect((await pool.query("SELECT 1 FROM events")).rowCount).toBe(1);
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

  it("protects and performs capacity changes", async () => {
    const id = await insertEvent("DRAFT", "capacity-event");
    const form = new FormData();
    form.set("newCapacity", "25");
    expect(await changeCapacityAction(id, initialState, form)).toMatchObject({ ok: false });
    expect(scheduleEmailDeliveryMock).not.toHaveBeenCalled();
    expect(
      (await pool.query<{ capacity: number }>("SELECT capacity FROM events WHERE id = $1", [id]))
        .rows[0]!.capacity,
    ).toBe(20);
    await authorize();
    expect(await changeCapacityAction(id, initialState, form)).toMatchObject({ ok: true });
    expect(scheduleEmailDeliveryMock).toHaveBeenCalledOnce();
    expect(
      (await pool.query<{ capacity: number }>("SELECT capacity FROM events WHERE id = $1", [id]))
        .rows[0]!.capacity,
    ).toBe(25);
  });

  it("protects and performs reservation cancellation", async () => {
    const eventId = await insertEvent("SCHEDULED", "reservation-cancel-event");
    const reservation = await pool.query<{ id: string }>(
      `INSERT INTO reservations (
         event_id, reservation_number, status, full_name, instagram_handle,
         phone_e164, email, email_normalized, party_size, notes,
         terms_accepted_at, idempotency_key, submitted_at, accepted_at
       ) VALUES ($1, 1, 'CONFIRMED', 'Ana Pérez', 'anaperez', '+50370000000',
         'ana@example.com', 'ana@example.com', 2, 'Sin lácteos', now(), $2, now(), now())
       RETURNING id`,
      [eventId, randomUUID()],
    );
    const reservationId = reservation.rows[0]!.id;
    await pool.query(
      "UPDATE events SET reserved_seats = 2, last_reservation_number = 1 WHERE id = $1",
      [eventId],
    );

    expect(
      await cancelReservationAction(eventId, reservationId, initialState, new FormData()),
    ).toMatchObject({ ok: false });
    expect(
      (
        await pool.query<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [
          reservationId,
        ])
      ).rows[0]!.status,
    ).toBe("CONFIRMED");
    expect(scheduleEmailDeliveryMock).not.toHaveBeenCalled();
    await authorize();
    expect(
      await cancelReservationAction(eventId, reservationId, initialState, new FormData()),
    ).toMatchObject({ ok: true });
    expect(scheduleEmailDeliveryMock).toHaveBeenCalledOnce();
    expect(
      (
        await pool.query<{ status: string }>("SELECT status FROM reservations WHERE id = $1", [
          reservationId,
        ])
      ).rows[0]!.status,
    ).toBe("CANCELLED");
    expect(
      (
        await pool.query<{ reserved_seats: number }>(
          "SELECT reserved_seats FROM events WHERE id = $1",
          [eventId],
        )
      ).rows[0]!.reserved_seats,
    ).toBe(0);
  });

  it("protects and cancels only a waiting queue entry", async () => {
    const eventId = await insertEvent("SCHEDULED", "waitlist-cancel-event");
    const entry = await pool.query<{ id: string }>(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
       ) VALUES ($1, 1, 'WAITING', 'Beto Gómez', 'betogomez', '+50370000001',
         'beto@example.com', 'beto@example.com', 1, now(), $2, now())
       RETURNING id`,
      [eventId, randomUUID()],
    );
    const entryId = entry.rows[0]!.id;
    await pool.query(
      "UPDATE events SET waitlisted_count = 1, waitlist_capacity = 5 WHERE id = $1",
      [eventId],
    );

    await expect(
      cancelWaitlistEntryAction(eventId, entryId, initialState, new FormData()),
    ).resolves.toMatchObject({ ok: false });
    expect(scheduleEmailDeliveryMock).not.toHaveBeenCalled();

    await authorize();
    await expect(
      cancelWaitlistEntryAction(eventId, entryId, initialState, new FormData()),
    ).resolves.toMatchObject({ ok: true });
    expect(scheduleEmailDeliveryMock).toHaveBeenCalledOnce();
    await expect(
      pool.query("SELECT status FROM waitlist_entries WHERE id = $1", [entryId]),
    ).resolves.toMatchObject({ rows: [{ status: "CANCELLED" }] });
    await expect(
      pool.query("SELECT kind FROM email_outbox WHERE waitlist_entry_id = $1", [entryId]),
    ).resolves.toMatchObject({ rows: [{ kind: "WAITLIST_CANCELLED" }] });
  });
});
