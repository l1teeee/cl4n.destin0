import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CreateEventCommand, EventOperationResult } from "@/application/events/types";
import type { EventLifecycleStatus } from "@/domain/event/event-phase";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresEventRepository;
let adminId: string;

const baseCommand: CreateEventCommand = {
  internalName: "Cena principal",
  slug: "cena-principal",
  startsAt: new Date("2026-11-21T01:30:00Z"),
  opensAt: new Date("2026-11-01T14:00:00Z"),
  closesAt: new Date("2026-11-20T02:00:00Z"),
  capacity: 20,
  maxPartySize: 2,
  autoCloseOnFull: false,
  status: "DRAFT",
};

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventRepository(pool);
});

beforeEach(async () => {
  await resetRows();
});

afterAll(async () => {
  await pool.end();
});

async function resetRows(): Promise<void> {
  // audit_logs is append-only, so reset the schema between tests that need a clean audit stream.
  await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresEventRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('admin@example.com', 'admin@example.com', 'hash', 'Admin')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
}

async function insertEvent(
  status: EventLifecycleStatus,
  overrides: Partial<CreateEventCommand> = {},
): Promise<string> {
  const command = {
    ...baseCommand,
    ...overrides,
    status: status === "DRAFT" ? "DRAFT" : "SCHEDULED",
  };
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       internal_name, slug, starts_at, capacity, max_party_size,
       opens_at, closes_at, auto_close_on_full, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      command.internalName,
      overrides.slug ?? `event-${randomUUID()}`,
      command.startsAt,
      command.capacity,
      command.maxPartySize,
      command.opensAt,
      command.closesAt,
      command.autoCloseOnFull,
      status,
    ],
  );
  return result.rows[0]!.id;
}

function expectError(result: EventOperationResult<unknown>, error: string): void {
  expect(result).toEqual({ ok: false, error });
}

async function auditFor(eventId: string) {
  return pool.query<{
    actor_type: string;
    actor_admin_id: string | null;
    action: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT actor_type, actor_admin_id, action, metadata
       FROM audit_logs
      WHERE entity_id = $1
      ORDER BY id`,
    [eventId],
  );
}

describe("event mutations", () => {
  it("creates an event and its non-PII audit row in one transaction", async () => {
    const result = await repository.create(baseCommand, adminId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await pool.query("SELECT * FROM events WHERE id = $1", [result.value.id]);
    expect(stored.rows[0]).toMatchObject({
      slug: baseCommand.slug,
      status: "DRAFT",
      capacity: 20,
    });
    const audit = await auditFor(result.value.id);
    expect(audit.rows).toEqual([
      {
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        action: "EVENT_CREATED",
        metadata: { status: "DRAFT" },
      },
    ]);
    expect(JSON.stringify(audit.rows[0]!.metadata)).not.toMatch(/email|phone|instagram|notes/i);
  });

  it("maps the events_slug_uq violation to SLUG_TAKEN", async () => {
    await repository.create(baseCommand, adminId);
    expectError(await repository.create(baseCommand, adminId), "SLUG_TAKEN");
  });

  it("updates allowed fields, audits before/after, and locks slug after DRAFT", async () => {
    const created = await repository.create(baseCommand, adminId);
    if (!created.ok) throw new Error(created.error);
    const update = {
      id: created.value.id,
      internalName: "Cena actualizada",
      slug: "cena-actualizada",
      startsAt: new Date("2026-11-22T01:30:00Z"),
      maxPartySize: 4,
      opensAt: baseCommand.opensAt,
      closesAt: baseCommand.closesAt,
      autoCloseOnFull: true,
    };

    const updated = await repository.update(update, adminId);
    expect(updated.ok && updated.value).toMatchObject({
      internalName: "Cena actualizada",
      slug: "cena-actualizada",
      maxPartySize: 4,
      autoCloseOnFull: true,
    });
    const audits = await auditFor(created.value.id);
    expect(audits.rows[1]).toMatchObject({ action: "EVENT_UPDATED" });
    expect(audits.rows[1]!.metadata).toMatchObject({
      changedFields: expect.arrayContaining([
        "internalName",
        "slug",
        "startsAt",
        "maxPartySize",
        "autoCloseOnFull",
      ]),
      before: expect.any(Object),
      after: expect.any(Object),
    });

    await repository.publish(created.value.id, adminId);
    expectError(
      await repository.update({ ...update, slug: "slug-bloqueado" }, adminId),
      "SLUG_LOCKED",
    );
    expectError(
      await repository.update({ ...update, slug: "cena-actualizada", maxPartySize: 21 }, adminId),
      "MAX_PARTY_SIZE_ABOVE_CAPACITY",
    );
  });
});

describe("event lifecycle", () => {
  it.each([
    ["publish", "DRAFT", "SCHEDULED", "EVENT_UPDATED"],
    ["close", "SCHEDULED", "CLOSED", "EVENT_CLOSED"],
    ["complete", "CLOSED", "COMPLETED", "EVENT_UPDATED"],
    ["cancel", "DRAFT", "CANCELLED", "EVENT_UPDATED"],
    ["cancel", "SCHEDULED", "CANCELLED", "EVENT_UPDATED"],
    ["cancel", "CLOSED", "CANCELLED", "EVENT_UPDATED"],
  ] as const)("allows %s from %s", async (action, from, to, auditAction) => {
    const id = await insertEvent(from);
    const result =
      action === "publish"
        ? await repository.publish(id, adminId)
        : action === "close"
          ? await repository.closeNow(id, adminId)
          : action === "complete"
            ? await repository.complete(id, adminId)
            : await repository.cancel(id, adminId);
    expect(result.ok && result.value.status).toBe(to);
    expect((await auditFor(id)).rows[0]!.action).toBe(auditAction);
  });

  it.each([
    ["publish", "SCHEDULED"],
    ["publish", "CLOSED"],
    ["publish", "COMPLETED"],
    ["publish", "CANCELLED"],
    ["close", "DRAFT"],
    ["close", "CLOSED"],
    ["close", "COMPLETED"],
    ["close", "CANCELLED"],
    ["complete", "DRAFT"],
    ["complete", "SCHEDULED"],
    ["complete", "COMPLETED"],
    ["complete", "CANCELLED"],
    ["cancel", "COMPLETED"],
    ["cancel", "CANCELLED"],
  ] as const)("rejects %s from %s", async (action, from) => {
    const id = await insertEvent(from);
    const result =
      action === "publish"
        ? await repository.publish(id, adminId)
        : action === "close"
          ? await repository.closeNow(id, adminId)
          : action === "complete"
            ? await repository.complete(id, adminId)
            : await repository.cancel(id, adminId);
    expectError(result, "INVALID_TRANSITION");
    expect((await auditFor(id)).rows).toHaveLength(0);
  });

  it.each(["DRAFT", "SCHEDULED", "CLOSED"] as const)("opens now from %s", async (from) => {
    const id = await insertEvent(from, {
      opensAt: new Date(Date.now() - 3_600_000),
      closesAt: new Date(Date.now() + 86_400_000),
    });
    const before = new Date();
    const result = await repository.openNow(id, adminId);
    const after = new Date();
    expect(result.ok && result.value.status).toBe("SCHEDULED");
    if (result.ok) {
      expect(result.value.opensAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.value.opensAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1_000);
    }
    expect((await auditFor(id)).rows[0]!.action).toBe("EVENT_OPENED");
  });

  it.each(["COMPLETED", "CANCELLED"] as const)("does not open now from %s", async (from) => {
    const id = await insertEvent(from, {
      opensAt: new Date(Date.now() - 3_600_000),
      closesAt: new Date(Date.now() + 86_400_000),
    });
    expectError(await repository.openNow(id, adminId), "INVALID_TRANSITION");
  });

  it("rejects OPEN NOW when closes_at is in the past", async () => {
    const id = await insertEvent("DRAFT", {
      opensAt: new Date(Date.now() - 172_800_000),
      closesAt: new Date(Date.now() - 86_400_000),
    });
    expectError(await repository.openNow(id, adminId), "CLOSES_AT_IN_PAST");
  });
});

describe("capacity changes", () => {
  async function eventWithReservedSeats(): Promise<string> {
    const id = await insertEvent("SCHEDULED", { capacity: 20, maxPartySize: 4 });
    for (let number = 1; number <= 2; number += 1) {
      await pool.query(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle,
           phone_e164, email, email_normalized, party_size, terms_accepted_at,
           idempotency_key, submitted_at, accepted_at
         )
         VALUES ($1, $2, 'CONFIRMED', $3, $4, $5, $6, $6, 3, now(), $7, now(), now())`,
        [
          id,
          number,
          `Guest ${number}`,
          `guest${number}`,
          `+5037000000${number}`,
          `guest${number}@example.com`,
          randomUUID(),
        ],
      );
    }
    await pool.query("UPDATE events SET reserved_seats = 6 WHERE id = $1", [id]);
    return id;
  }

  it("increases capacity and decreases to exactly allocated seats", async () => {
    const id = await eventWithReservedSeats();
    const increased = await repository.changeCapacity(id, 25, adminId);
    expect(increased.ok && increased.value.capacity).toBe(25);
    const exact = await repository.changeCapacity(id, 6, adminId);
    expect(exact.ok && exact.value.capacity).toBe(6);
    const audits = await auditFor(id);
    expect(audits.rows.map((row) => row.metadata)).toEqual([
      { from: 20, to: 25 },
      { from: 25, to: 6 },
    ]);
  });

  it("rejects capacity below allocated seats before the DB CHECK", async () => {
    const id = await eventWithReservedSeats();
    expectError(await repository.changeCapacity(id, 5, adminId), "CAPACITY_BELOW_ALLOCATED");
  });

  it("rejects capacity below max party size", async () => {
    const id = await insertEvent("SCHEDULED", { maxPartySize: 4 });
    expectError(await repository.changeCapacity(id, 3, adminId), "CAPACITY_BELOW_MAX_PARTY_SIZE");
  });
});

describe("event read models", () => {
  async function insertReservation(
    eventId: string,
    fullName: string,
    submittedAt: Date,
    status: "CONFIRMED" | "FULL_REJECTED" = "CONFIRMED",
    reservationNumber?: number,
  ): Promise<void> {
    const confirmed = status === "CONFIRMED";
    await pool.query(
      `INSERT INTO reservations (
         event_id, reservation_number, status, full_name, instagram_handle,
         phone_e164, email, email_normalized, party_size, terms_accepted_at,
         idempotency_key, submitted_at, accepted_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 1, now(), $8, $9, $10)`,
      [
        eventId,
        confirmed ? (reservationNumber ?? Math.floor(Math.random() * 1_000_000)) : null,
        status,
        fullName,
        fullName.toLowerCase().replaceAll(" ", ""),
        `+503${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        `${randomUUID()}@example.com`,
        randomUUID(),
        submittedAt,
        confirmed ? submittedAt : null,
      ],
    );
  }

  it("uses DB time for phases and returns counts and availability", async () => {
    const open = await insertEvent("SCHEDULED", {
      slug: "open-event",
      opensAt: new Date(Date.now() - 3_600_000),
      closesAt: new Date(Date.now() + 3_600_000),
      capacity: 2,
    });
    await insertReservation(open, "Confirmed Guest", new Date(), "CONFIRMED");
    await insertReservation(open, "Rejected Guest", new Date(), "FULL_REJECTED");
    await pool.query("UPDATE events SET reserved_seats = 1 WHERE id = $1", [open]);
    const full = await insertEvent("SCHEDULED", {
      slug: "full-event",
      opensAt: new Date(Date.now() - 3_600_000),
      closesAt: new Date(Date.now() + 3_600_000),
      capacity: 1,
      maxPartySize: 1,
    });
    await pool.query("UPDATE events SET reserved_seats = 1 WHERE id = $1", [full]);
    await insertEvent("DRAFT", { slug: "draft-event" });
    const scheduled = await insertEvent("SCHEDULED", {
      slug: "scheduled-event",
      opensAt: new Date(Date.now() + 3_600_000),
      closesAt: new Date(Date.now() + 7_200_000),
    });
    const expired = await insertEvent("SCHEDULED", {
      slug: "expired-event",
      opensAt: new Date(Date.now() - 7_200_000),
      closesAt: new Date(Date.now() - 3_600_000),
    });

    const list = await repository.listAdminEvents();
    expect(list.databaseTime).toBeInstanceOf(Date);
    expect(list.value.find((event) => event.id === open)).toMatchObject({
      phase: "OPEN",
      availableSeats: 1,
      confirmedReservationCount: 1,
    });
    expect(list.value.find((event) => event.id === full)?.phase).toBe("FULL");
    expect(list.value.find((event) => event.id === scheduled)?.phase).toBe("SCHEDULED");
    expect(list.value.find((event) => event.id === expired)?.phase).toBe("CLOSED");
    const detail = await repository.getAdminEvent(open);
    expect(detail.value).toMatchObject({ id: open, phase: "OPEN" });

    const home = await repository.getPublicHomeEvents();
    expect(home.value.map((event) => event.slug).sort()).toEqual(["full-event", "open-event"]);
    expect(Object.keys(home.value[0]!).sort()).toEqual([
      "maxPartySize",
      "phase",
      "slug",
      "startsAt",
    ]);
    await expect(repository.getPublicEventBySlug("draft-event")).resolves.toMatchObject({
      value: null,
    });
  });

  it("escapes percent, underscore, and backslash in reservation search", async () => {
    const eventId = await insertEvent("SCHEDULED");
    await insertReservation(eventId, "Percent%Guest", new Date("2026-01-01T00:00:00Z"));
    await insertReservation(eventId, "PercentXGuest", new Date("2026-01-02T00:00:00Z"));
    await insertReservation(eventId, "Under_Guest", new Date("2026-01-03T00:00:00Z"));
    await insertReservation(eventId, "UnderXGuest", new Date("2026-01-04T00:00:00Z"));
    await insertReservation(eventId, "Slash\\Guest", new Date("2026-01-05T00:00:00Z"));

    const percent = await repository.listAdminReservations({ eventId, search: "%" });
    const underscore = await repository.listAdminReservations({ eventId, search: "_" });
    const slash = await repository.listAdminReservations({ eventId, search: "\\" });
    expect(percent.value.map((row) => row.fullName)).toEqual(["Percent%Guest"]);
    expect(underscore.value.map((row) => row.fullName)).toEqual(["Under_Guest"]);
    expect(slash.value.map((row) => row.fullName)).toEqual(["Slash\\Guest"]);
  });

  it("returns reservation notes in the admin read model", async () => {
    const eventId = await insertEvent("SCHEDULED");
    await insertReservation(eventId, "Guest With Notes", new Date());
    await pool.query("UPDATE reservations SET notes = $2 WHERE event_id = $1", [
      eventId,
      "Alergia a los mariscos",
    ]);

    const reservations = await repository.listAdminReservations({ eventId });
    expect(reservations.value[0]?.notes).toBe("Alergia a los mariscos");
  });

  it("allow-lists sorting and defaults to newest submissions first", async () => {
    const eventId = await insertEvent("SCHEDULED");
    await insertReservation(
      eventId,
      "Zulu Older",
      new Date("2026-01-01T00:00:00Z"),
      "CONFIRMED",
      2,
    );
    await insertReservation(
      eventId,
      "Alpha Newer",
      new Date("2026-01-02T00:00:00Z"),
      "CONFIRMED",
      1,
    );
    await insertReservation(eventId, "Rejected", new Date("2026-01-03T00:00:00Z"), "FULL_REJECTED");
    const defaultOrder = await repository.listAdminReservations({ eventId });
    expect(defaultOrder.value.map((row) => row.fullName)).toEqual([
      "Rejected",
      "Alpha Newer",
      "Zulu Older",
    ]);

    const byName = await repository.listAdminReservations({
      eventId,
      sort: "name",
      direction: "asc",
    });
    expect(byName.value.map((row) => row.fullName)).toEqual([
      "Alpha Newer",
      "Rejected",
      "Zulu Older",
    ]);
    const byNumber = await repository.listAdminReservations({
      eventId,
      status: "CONFIRMED",
      sort: "number",
      direction: "asc",
    });
    expect(byNumber.value.map((row) => row.reservationNumber)).toEqual([1, 2]);
    expect(byNumber.value.every((row) => row.status === "CONFIRMED")).toBe(true);

    const unsafe = await repository.listAdminReservations({
      eventId,
      sort: "submitted_at; DELETE FROM events" as never,
      direction: "sideways" as never,
    });
    expect(unsafe.value.map((row) => row.fullName)).toEqual([
      "Rejected",
      "Alpha Newer",
      "Zulu Older",
    ]);
    expect(await pool.query("SELECT count(*)::int AS count FROM events")).toMatchObject({
      rows: [{ count: 1 }],
    });
  });

  it("filters and paginates audit logs newest first", async () => {
    const first = await repository.create({ ...baseCommand, slug: "audit-first" }, adminId);
    const second = await repository.create({ ...baseCommand, slug: "audit-second" }, adminId);
    if (!first.ok || !second.ok) throw new Error("fixture creation failed");
    await repository.changeCapacity(first.value.id, 21, adminId);

    const page = await repository.listAuditLogs({
      entityType: "EVENT",
      entityId: first.value.id,
      page: 1,
      pageSize: 1,
    });
    expect(page.value).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(page.value.items[0]).toMatchObject({ action: "CAPACITY_CHANGED" });
    expect(page.databaseTime).toBeInstanceOf(Date);
  });

  it("returns event and related reservation entries for an event audit", async () => {
    const created = await repository.create({ ...baseCommand, slug: "audit-related" }, adminId);
    if (!created.ok) throw new Error("fixture creation failed");
    const reservationId = randomUUID();
    await pool.query(
      `INSERT INTO audit_logs (
         actor_type, action, entity_type, entity_id, metadata
       ) VALUES ('PUBLIC', 'RESERVATION_CREATED', 'RESERVATION', $1, $2::jsonb)`,
      [reservationId, JSON.stringify({ eventId: created.value.id, partySize: 2 })],
    );

    const audit = await repository.listAuditLogs({ eventId: created.value.id });
    expect(audit.value.items.map((item) => item.action)).toEqual([
      "RESERVATION_CREATED",
      "EVENT_CREATED",
    ]);
  });
});
