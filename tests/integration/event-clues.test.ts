import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  listClueRecipients,
  publishEventClue,
  removeEventClue,
  sendClueToAll,
  sendClueToGuest,
} from "@/application/events/event-clues";
import type { EventLifecycleStatus } from "@/domain/event/event-phase";
import { PostgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";

import { insertGuestReservation, insertMessagingContact } from "../helpers/guest-flow-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let clueRepository: PostgresEventClueRepository;
let eventRepository: PostgresEventRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  clueRepository = new PostgresEventClueRepository(pool);
  eventRepository = new PostgresEventRepository(pool);
});

beforeEach(async () => {
  await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  clueRepository = new PostgresEventClueRepository(pool);
  eventRepository = new PostgresEventRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, 'hash', 'Admin') RETURNING id`,
    [`${randomUUID()}@example.com`],
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

type EventWindow = "OPEN" | "PAST" | "UPCOMING";

async function createEvent(
  status: EventLifecycleStatus = "CLOSED",
  window: EventWindow = "UPCOMING",
): Promise<{ id: string; slug: string }> {
  const now = Date.now();
  const windows = {
    OPEN: [new Date(now - 60 * 60 * 1000), new Date(now + 60 * 60 * 1000)],
    PAST: [new Date(now - 2 * 60 * 60 * 1000), new Date(now - 60 * 60 * 1000)],
    UPCOMING: [new Date(now + 60 * 60 * 1000), new Date(now + 2 * 60 * 60 * 1000)],
  } as const;
  const [opensAt, closesAt] = windows[window];
  const slug = `clues-${randomUUID()}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at, status
     ) VALUES ($1, 'Pistas', $2, 10, 2, $3, $4, $5::event_status)
     RETURNING id`,
    [slug, new Date(now + 24 * 60 * 60 * 1000), opensAt, closesAt, status],
  );
  return { id: result.rows[0]!.id, slug };
}

function add(eventId: string, body: string) {
  return clueRepository.add({ eventId, body, actorId: adminId });
}

describe("event clue repository", () => {
  it("stores clue images atomically and serves them only through their visible event slug", async () => {
    const event = await createEvent();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const clue = await clueRepository.add({
      eventId: event.id,
      body: "Mira la imagen.",
      actorId: adminId,
      images: [{ contentType: "image/png", data: png }],
    });
    if (!clue.ok) throw new Error("Expected clue to be added");

    const listed = await clueRepository.listForEvent(event.id);
    expect(listed[0]?.images).toHaveLength(1);
    expect(clue.value.images).toEqual(listed[0]!.images);
    const imageId = listed[0]!.images[0]!.id;
    await expect(clueRepository.getImageForSlug(event.slug, imageId)).resolves.toEqual({
      contentType: "image/png",
      data: png,
    });
    await expect(clueRepository.getImageForSlug("another-event", imageId)).resolves.toBeNull();

    await pool.query("UPDATE events SET status = 'COMPLETED' WHERE id = $1", [event.id]);
    await expect(clueRepository.getImageForSlug(event.slug, imageId)).resolves.toEqual({
      contentType: "image/png",
      data: png,
    });
    await pool.query("UPDATE events SET status = 'CANCELLED' WHERE id = $1", [event.id]);
    await expect(clueRepository.getImageForSlug(event.slug, imageId)).resolves.toBeNull();
  });

  it("adds, lists, removes, and audits clues", async () => {
    const event = await createEvent();
    const first = await add(event.id, "Primera pista");
    const second = await add(event.id, "Segunda pista");
    if (!first.ok || !second.ok) throw new Error("Expected both clues to be added");

    expect(await clueRepository.listForEvent(event.id)).toEqual([first.value, second.value]);
    expect(
      await clueRepository.remove({ eventId: event.id, clueId: first.value.id, actorId: adminId }),
    ).toBe(true);
    expect(await clueRepository.listForEvent(event.id)).toEqual([second.value]);

    const audit = await pool.query<{
      action: string;
      actor_type: string;
      entity_type: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT action, actor_type, entity_type, metadata
         FROM audit_logs
        WHERE entity_id = $1
        ORDER BY id`,
      [event.id],
    );
    expect(audit.rows).toEqual([
      {
        action: "EVENT_UPDATED",
        actor_type: "ADMIN",
        entity_type: "EVENT",
        metadata: { clueAdded: first.value.id },
      },
      {
        action: "EVENT_UPDATED",
        actor_type: "ADMIN",
        entity_type: "EVENT",
        metadata: { clueAdded: second.value.id },
      },
      {
        action: "EVENT_UPDATED",
        actor_type: "ADMIN",
        entity_type: "EVENT",
        metadata: { clueRemoved: first.value.id },
      },
    ]);
  });

  it("serves images only for the requested live event slug", async () => {
    const requested = await createEvent();
    const other = await createEvent();
    const requestedClue = await clueRepository.add({
      eventId: requested.id,
      body: "Visible",
      actorId: adminId,
      images: [{ contentType: "image/png", data: Buffer.from([1]) }],
    });
    await add(other.id, "Otra experiencia");
    if (!requestedClue.ok) throw new Error(requestedClue.error);

    const imageId = requestedClue.value.images[0]!.id;
    expect(await clueRepository.listForEvent(requested.id)).toEqual([requestedClue.value]);
    await expect(clueRepository.getImageForSlug(requested.slug, imageId)).resolves.toEqual({
      contentType: "image/png",
      data: Buffer.from([1]),
    });
    await expect(clueRepository.getImageForSlug(other.slug, imageId)).resolves.toBeNull();

    await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [
      requested.id,
    ]);
    await expect(clueRepository.getImageForSlug(requested.slug, imageId)).resolves.toBeNull();
  });

  it("stores a prepared clue without queuing messages for paid guests", async () => {
    const event = await createEvent();
    await insertGuestReservation(pool, event.id);

    const clue = await publishEventClue(eventRepository, clueRepository, {
      eventId: event.id,
      body: "Lista para enviar",
      actorId: adminId,
    });

    expect(clue).toEqual({
      ok: true,
      value: expect.objectContaining({ body: "Lista para enviar" }),
    });
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE event_id = $1", [event.id])).rows,
    ).toEqual([]);
  });

  it("sends once per paid reservation and audits only sends that queue messages", async () => {
    const event = await createEvent();
    const other = await createEvent();
    const linked = await insertGuestReservation(pool, event.id, {
      contactId: await insertMessagingContact(pool),
      guest2FullName: "Luis Pérez",
    });
    const unlinked = await insertGuestReservation(pool, event.id);
    await insertGuestReservation(pool, event.id, { stage: "IN_REVIEW" });
    await insertGuestReservation(pool, event.id, { stage: "ON_LIST" });
    await insertGuestReservation(pool, event.id, { status: "CANCELLED" });
    await insertGuestReservation(pool, other.id);
    const clue = await add(event.id, "Para invitados confirmados");
    if (!clue.ok) throw new Error(clue.error);
    const input = { eventId: event.id, clueId: clue.value.id, actorId: adminId };

    const sent = await sendClueToAll(eventRepository, clueRepository, input);
    if (!sent.ok) throw new Error(sent.error);
    expect(sent.messageIds).toHaveLength(2);
    await expect(sendClueToAll(eventRepository, clueRepository, input)).resolves.toEqual({
      ok: true,
      messageIds: [],
    });
    const messages = await pool.query<{ id: string; reservation_id: string; status: string }>(
      "SELECT id, reservation_id, status FROM messages WHERE clue_id = $1",
      [clue.value.id],
    );
    expect(messages.rows.map((row) => row.id).sort()).toEqual(sent.messageIds.sort());
    expect(messages.rows).toEqual(
      expect.arrayContaining([
        { id: expect.any(String), reservation_id: linked, status: "QUEUED" },
        { id: expect.any(String), reservation_id: unlinked, status: "WAITING_CONTACT" },
      ]),
    );
    const audits = await pool.query<{ actor_admin_id: string; metadata: unknown }>(
      "SELECT actor_admin_id, metadata FROM audit_logs WHERE entity_id = $1 AND metadata ? 'clueSent'",
      [event.id],
    );
    expect(audits.rows).toEqual([
      { actor_admin_id: adminId, metadata: { clueSent: clue.value.id, recipients: 2 } },
    ]);

    const lateGuest = await insertGuestReservation(pool, event.id);
    const lateSend = await clueRepository.sendToAll(input);
    if (!lateSend.ok) throw new Error(lateSend.error);
    expect(lateSend.messageIds).toHaveLength(1);
    const lateMessage = await pool.query<{ reservation_id: string }>(
      "SELECT reservation_id FROM messages WHERE id = $1",
      [lateSend.messageIds[0]],
    );
    expect(lateMessage.rows).toEqual([{ reservation_id: lateGuest }]);
  });

  it("sends to one paid guest only, rejects ineligible guests, and queues no repeat", async () => {
    const event = await createEvent();
    const other = await createEvent();
    const eligible = await insertGuestReservation(pool, event.id);
    const untouched = await insertGuestReservation(pool, event.id);
    const inReview = await insertGuestReservation(pool, event.id, { stage: "IN_REVIEW" });
    const onList = await insertGuestReservation(pool, event.id, { stage: "ON_LIST" });
    const cancelled = await insertGuestReservation(pool, event.id, { status: "CANCELLED" });
    const otherGuest = await insertGuestReservation(pool, other.id);
    const clue = await add(event.id, "Una sola persona");
    if (!clue.ok) throw new Error(clue.error);
    const input = { eventId: event.id, clueId: clue.value.id, actorId: adminId };

    for (const reservationId of [inReview, onList, cancelled, otherGuest, randomUUID()]) {
      await expect(
        sendClueToGuest(eventRepository, clueRepository, {
          ...input,
          reservationId,
        }),
      ).resolves.toEqual({ ok: false, error: "GUEST_NOT_ELIGIBLE" });
    }
    const sent = await sendClueToGuest(eventRepository, clueRepository, {
      ...input,
      reservationId: eligible,
    });
    if (!sent.ok) throw new Error(sent.error);
    expect(sent.messageIds).toHaveLength(1);
    await expect(
      clueRepository.sendToGuest({ ...input, reservationId: eligible }),
    ).resolves.toEqual({ ok: true, messageIds: [] });
    const messages = await pool.query<{ reservation_id: string }>(
      "SELECT reservation_id FROM messages WHERE clue_id = $1",
      [clue.value.id],
    );
    expect(messages.rows).toEqual([{ reservation_id: eligible }]);
    expect(messages.rows.map((row) => row.reservation_id)).not.toContain(untouched);
  });

  it("reports missing, other-event, and soft-deleted clues without queuing", async () => {
    const event = await createEvent();
    const other = await createEvent();
    const reservationId = await insertGuestReservation(pool, event.id);
    const clue = await add(event.id, "No se envía");
    if (!clue.ok) throw new Error(clue.error);
    for (const input of [
      { eventId: event.id, clueId: randomUUID(), actorId: adminId },
      { eventId: other.id, clueId: clue.value.id, actorId: adminId },
    ]) {
      await expect(clueRepository.sendToAll(input)).resolves.toEqual({
        ok: false,
        error: "CLUE_NOT_FOUND",
      });
      await expect(clueRepository.sendToGuest({ ...input, reservationId })).resolves.toEqual({
        ok: false,
        error: "CLUE_NOT_FOUND",
      });
    }
    await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [event.id]);
    await expect(
      clueRepository.sendToAll({ eventId: event.id, clueId: clue.value.id, actorId: adminId }),
    ).resolves.toEqual({ ok: false, error: "CLUE_NOT_FOUND" });
    expect((await pool.query("SELECT 1 FROM messages")).rows).toEqual([]);
  });

  it("lists paid recipients in reservation order with every clue delivery state", async () => {
    const event = await createEvent();
    await pool.query("UPDATE events SET capacity = 20 WHERE id = $1", [event.id]);
    const contactId = await insertMessagingContact(pool);
    await pool.query("UPDATE messaging_contacts SET username = 'ana.linked' WHERE id = $1", [
      contactId,
    ]);
    const statuses = [
      "SENT",
      "READ",
      "SENT_MANUALLY",
      "WAITING_CONTACT",
      "WAITING_WINDOW",
      "QUEUED",
      "FAILED",
      "DISCARDED",
    ];
    const reservations: string[] = [];
    for (const [index, status] of statuses.entries()) {
      reservations.push(
        await insertGuestReservation(pool, event.id, {
          fullName: `Invitado ${index}`,
          contactId: status === "WAITING_CONTACT" ? null : contactId,
          guest2FullName: index === 0 ? "María Pérez" : null,
        }),
      );
    }
    await insertGuestReservation(pool, event.id, { stage: "ON_LIST" });
    await insertGuestReservation(pool, event.id, { stage: "IN_REVIEW" });
    await insertGuestReservation(pool, event.id, { status: "CANCELLED" });
    const other = await createEvent();
    await insertGuestReservation(pool, other.id);
    const clue = await add(event.id, "Estados");
    const unsentClue = await add(event.id, "Todavía sin enviar");
    if (!clue.ok || !unsentClue.ok) throw new Error("Expected clues");
    const sent = await clueRepository.sendToAll({
      eventId: event.id,
      clueId: clue.value.id,
      actorId: adminId,
    });
    if (!sent.ok) throw new Error(sent.error);
    for (const [index, status] of statuses.entries()) {
      await pool.query(
        `UPDATE messages SET status = $3,
                sent_at = CASE WHEN $3 IN ('SENT', 'READ', 'SENT_MANUALLY') THEN now() END,
                read_at = CASE WHEN $3 = 'READ' THEN now() END
          WHERE reservation_id = $1 AND clue_id = $2`,
        [reservations[index], clue.value.id, status],
      );
    }
    const neverSent = await insertGuestReservation(pool, event.id, { fullName: "Sin envío" });
    const recipients = await listClueRecipients(clueRepository, event.id);
    expect(recipients.map((recipient) => recipient.reservationId)).toEqual([
      ...reservations,
      neverSent,
    ]);
    expect(recipients.map((recipient) => recipient.statusByClue[clue.value.id])).toEqual([
      "SENT",
      "SENT",
      "SENT",
      "PENDING",
      "PENDING",
      "PENDING",
      "FAILED",
      "NOT_SENT",
      "NOT_SENT",
    ]);
    expect(
      recipients.every((recipient) => recipient.statusByClue[unsentClue.value.id] === "NOT_SENT"),
    ).toBe(true);
    expect(recipients[0]).toMatchObject({
      guestName: "Invitado 0 y María Pérez",
      instagram: "ana.linked",
    });
    const fallback = await pool.query<{ instagram_handle: string }>(
      "SELECT instagram_handle FROM reservations WHERE id = $1",
      [reservations[3]],
    );
    expect(recipients[3]).toMatchObject({
      guestName: "Invitado 3",
      instagram: fallback.rows[0]!.instagram_handle,
    });
    await pool.query("UPDATE messaging_contacts SET username = NULL WHERE id = $1", [contactId]);
    const linkedFallback = await pool.query<{ instagram_handle: string }>(
      "SELECT instagram_handle FROM reservations WHERE id = $1",
      [reservations[0]],
    );
    expect((await clueRepository.listRecipients(event.id))[0]?.instagram).toBe(
      linkedFallback.rows[0]!.instagram_handle,
    );
  });

  it("lists recipients without clues and returns no recipients for an empty event", async () => {
    const event = await createEvent();
    await expect(clueRepository.listRecipients(event.id)).resolves.toEqual([]);
    const reservationId = await insertGuestReservation(pool, event.id);
    expect(await clueRepository.listRecipients(event.id)).toEqual([
      expect.objectContaining({ reservationId, statusByClue: {} }),
    ]);
  });

  it("does not add a clue to a missing or soft-deleted event", async () => {
    const event = await createEvent();
    await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [event.id]);

    await expect(add(event.id, "No se guarda")).resolves.toEqual({
      ok: false,
      error: "EVENT_NOT_FOUND",
    });
    await expect(add(randomUUID(), "No se guarda")).resolves.toEqual({
      ok: false,
      error: "EVENT_NOT_FOUND",
    });

    expect((await pool.query("SELECT 1 FROM event_clues")).rowCount).toBe(0);
    expect(
      (await pool.query("SELECT 1 FROM audit_logs WHERE entity_id = $1", [event.id])).rowCount,
    ).toBe(0);
  });

  it("enforces clue body length in PostgreSQL", async () => {
    const event = await createEvent();
    await expect(
      pool.query("INSERT INTO event_clues (event_id, body, created_by) VALUES ($1, '', $2)", [
        event.id,
        adminId,
      ]),
    ).rejects.toMatchObject({ constraint: "event_clues_body_length_chk" });
    await expect(
      pool.query("INSERT INTO event_clues (event_id, body, created_by) VALUES ($1, $2, $3)", [
        event.id,
        "a".repeat(501),
        adminId,
      ]),
    ).rejects.toMatchObject({ constraint: "event_clues_body_length_chk" });
  });

  it("does not remove a clue through another event", async () => {
    const first = await createEvent();
    const second = await createEvent();
    const clue = await add(first.id, "Permanece");
    if (!clue.ok) throw new Error(clue.error);

    expect(
      await clueRepository.remove({ eventId: second.id, clueId: clue.value.id, actorId: adminId }),
    ).toBe(false);
    expect(await clueRepository.listForEvent(first.id)).toEqual([clue.value]);
  });
});

describe("event clue use cases", () => {
  it.each([
    ["DRAFT", "UPCOMING"],
    ["SCHEDULED", "OPEN"],
    ["SCHEDULED", "UPCOMING"],
    ["COMPLETED", "PAST"],
    ["CANCELLED", "PAST"],
  ] as const)("rejects sending for a %s event in an %s window", async (status, window) => {
    const event = await createEvent(status, window);
    const reservationId = await insertGuestReservation(pool, event.id);
    const clue = await add(event.id, "No se envía");
    if (!clue.ok) throw new Error(clue.error);
    const input = { eventId: event.id, clueId: clue.value.id, actorId: adminId };

    await expect(sendClueToAll(eventRepository, clueRepository, input)).resolves.toEqual({
      ok: false,
      error: "CLUES_CLOSED",
    });
    await expect(
      sendClueToGuest(eventRepository, clueRepository, {
        ...input,
        reservationId,
      }),
    ).resolves.toEqual({ ok: false, error: "CLUES_CLOSED" });
    expect(
      (await pool.query("SELECT 1 FROM messages WHERE event_id = $1", [event.id])).rows,
    ).toEqual([]);
  });

  it("sends for a scheduled event whose close time passed", async () => {
    const event = await createEvent("SCHEDULED", "PAST");
    const reservationId = await insertGuestReservation(pool, event.id);
    const clue = await add(event.id, "Fase cerrada");
    if (!clue.ok) throw new Error(clue.error);
    const input = { eventId: event.id, clueId: clue.value.id, actorId: adminId };

    const result = await sendClueToGuest(eventRepository, clueRepository, {
      ...input,
      reservationId,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.messageIds).toHaveLength(1);
    await expect(sendClueToAll(eventRepository, clueRepository, input)).resolves.toEqual({
      ok: true,
      messageIds: [],
    });
  });

  it.each([
    ["DRAFT", "UPCOMING"],
    ["SCHEDULED", "OPEN"],
    ["COMPLETED", "PAST"],
  ] as const)("rejects publishing for a %s event in an %s window", async (status, window) => {
    const event = await createEvent(status, window);

    await expect(
      publishEventClue(eventRepository, clueRepository, {
        eventId: event.id,
        body: "No se publica",
        actorId: adminId,
      }),
    ).resolves.toEqual({ ok: false, error: "CLUES_CLOSED" });
  });

  it("publishes for an explicitly closed event", async () => {
    const event = await createEvent("CLOSED", "UPCOMING");

    const result = await publishEventClue(eventRepository, clueRepository, {
      eventId: event.id,
      body: "Publicada",
      actorId: adminId,
    });

    expect(result.ok).toBe(true);
  });

  it("publishes for a scheduled event whose close time passed", async () => {
    const event = await createEvent("SCHEDULED", "PAST");

    const result = await publishEventClue(eventRepository, clueRepository, {
      eventId: event.id,
      body: "Publicada por fase derivada",
      actorId: adminId,
    });

    expect(result.ok).toBe(true);
  });

  it("reports a missing or soft-deleted event when publishing or removing", async () => {
    const deleted = await createEvent();
    await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [
      deleted.id,
    ]);

    for (const eventId of [randomUUID(), deleted.id]) {
      await expect(
        publishEventClue(eventRepository, clueRepository, {
          eventId,
          body: "No existe",
          actorId: adminId,
        }),
      ).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
      await expect(
        removeEventClue(eventRepository, clueRepository, {
          eventId,
          clueId: randomUUID(),
          actorId: adminId,
        }),
      ).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
      const sendInput = { eventId, clueId: randomUUID(), actorId: adminId };
      await expect(sendClueToAll(eventRepository, clueRepository, sendInput)).resolves.toEqual({
        ok: false,
        error: "EVENT_NOT_FOUND",
      });
      await expect(
        sendClueToGuest(eventRepository, clueRepository, {
          ...sendInput,
          reservationId: randomUUID(),
        }),
      ).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
    }
  });

  it("removes a clue while the event is closed and reports a missing clue", async () => {
    const event = await createEvent("CLOSED");
    const clue = await add(event.id, "Se elimina");
    if (!clue.ok) throw new Error(clue.error);
    const input = { eventId: event.id, clueId: clue.value.id, actorId: adminId };

    await expect(removeEventClue(eventRepository, clueRepository, input)).resolves.toEqual({
      ok: true,
    });
    await expect(removeEventClue(eventRepository, clueRepository, input)).resolves.toEqual({
      ok: false,
      error: "CLUE_NOT_FOUND",
    });
    expect(await clueRepository.listForEvent(event.id)).toEqual([]);
  });

  it.each([
    ["DRAFT", "UPCOMING"],
    ["SCHEDULED", "OPEN"],
    ["COMPLETED", "PAST"],
  ] as const)(
    "keeps clues when removing for a %s event in an %s window",
    async (status, window) => {
      const event = await createEvent(status, window);
      const clue = await add(event.id, "Permanece");
      if (!clue.ok) throw new Error(clue.error);

      await expect(
        removeEventClue(eventRepository, clueRepository, {
          eventId: event.id,
          clueId: clue.value.id,
          actorId: adminId,
        }),
      ).resolves.toEqual({ ok: false, error: "CLUES_CLOSED" });
      expect(await clueRepository.listForEvent(event.id)).toEqual([clue.value]);
    },
  );
});
