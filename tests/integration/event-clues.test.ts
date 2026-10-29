import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { publishEventClue, removeEventClue } from "@/application/events/event-clues";
import type { EventLifecycleStatus } from "@/domain/event/event-phase";
import { PostgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";

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

    const listed = await clueRepository.listForSlug(event.slug);
    expect(listed[0]?.images).toHaveLength(1);
    expect(clue.value.images).toEqual(listed[0]!.images);
    expect((await clueRepository.listForEvent(event.id))[0]?.images).toEqual(listed[0]!.images);
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

  it("lists only the requested live event by slug", async () => {
    const requested = await createEvent();
    const other = await createEvent();
    const requestedClue = await add(requested.id, "Visible");
    await add(other.id, "Otra experiencia");
    if (!requestedClue.ok) throw new Error(requestedClue.error);

    expect(await clueRepository.listForSlug(requested.slug)).toEqual([requestedClue.value]);

    await pool.query("UPDATE events SET deleted_at = clock_timestamp() WHERE id = $1", [
      requested.id,
    ]);
    expect(await clueRepository.listForSlug(requested.slug)).toEqual([]);
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
