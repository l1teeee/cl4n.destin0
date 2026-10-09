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
  waitlistCapacity: 5,
  status: "DRAFT",
  location: {
    name: null,
    address: null,
    mapsUrl: null,
    notes: null,
    status: "PENDING",
  },
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

  it("persists location, tracks revisions, and preserves confirmation timestamps", async () => {
    const created = await repository.create(
      {
        ...baseCommand,
        location: {
          name: "Casa 503",
          address: "San Salvador",
          mapsUrl: null,
          notes: "Entrada lateral",
          status: "CONFIRMED",
        },
      },
      adminId,
    );
    if (!created.ok) throw new Error(created.error);
    expect(created.value.location).toMatchObject({
      name: "Casa 503",
      status: "CONFIRMED",
      confirmedAt: expect.any(Date),
    });
    const confirmedAt = created.value.location.confirmedAt!.getTime();

    const command = {
      id: created.value.id,
      internalName: created.value.internalName,
      slug: created.value.slug,
      startsAt: created.value.startsAt,
      maxPartySize: created.value.maxPartySize,
      opensAt: created.value.opensAt,
      closesAt: created.value.closesAt,
      autoCloseOnFull: created.value.autoCloseOnFull,
      waitlistCapacity: created.value.waitlistCapacity,
      location: {
        name: created.value.location.name,
        address: created.value.location.address,
        mapsUrl: created.value.location.mapsUrl,
        notes: created.value.location.notes,
        status: created.value.location.status,
      },
      expectedLocation: { revision: 0, status: created.value.location.status },
    };
    const unchanged = await repository.update(command, adminId);
    expect(unchanged.ok && unchanged.value.location.confirmedAt?.getTime()).toBe(confirmedAt);
    expect(unchanged.ok && unchanged.value.locationRevision).toBe(0);

    const changed = await repository.update(
      { ...command, location: { ...command.location, notes: "Nueva entrada" } },
      adminId,
    );
    expect(changed.ok && changed.value.locationRevision).toBe(1);
    const pending = await repository.setLocationStatus(
      created.value.id,
      "PENDING",
      { revision: 1, status: "CONFIRMED" },
      adminId,
    );
    expect(pending.ok && pending.value.location.confirmedAt).toBeNull();
    expect(pending.ok && pending.value.locationRevision).toBe(1);
    const reconfirmed = await repository.setLocationStatus(
      created.value.id,
      "CONFIRMED",
      { revision: 1, status: "PENDING" },
      adminId,
    );
    expect(reconfirmed.ok && reconfirmed.value.location.confirmedAt).toBeInstanceOf(Date);
    const audits = await auditFor(created.value.id);
    expect(
      audits.rows.some(
        (row) =>
          row.action === "EVENT_UPDATED" &&
          Array.isArray(row.metadata.changedFields) &&
          row.metadata.changedFields.includes("locationNotes"),
      ),
    ).toBe(true);
    expect(audits.rows.at(-1)?.metadata).toMatchObject({
      changedFields: expect.arrayContaining(["locationStatus", "locationConfirmedAt"]),
    });
    const notesAudit = audits.rows.find(
      (row) =>
        Array.isArray(row.metadata.changedFields) &&
        row.metadata.changedFields.includes("locationNotes"),
    )!;
    expect(notesAudit.metadata.locationNotes).toEqual({ changed: true });
    expect(JSON.stringify(notesAudit.metadata.before)).not.toContain("Entrada lateral");
    expect(JSON.stringify(notesAudit.metadata.after)).not.toContain("Nueva entrada");
  });

  it("rejects stale location edits and quick status changes", async () => {
    const created = await repository.create(
      {
        ...baseCommand,
        slug: "stale-location",
        location: {
          name: "Casa",
          address: "Calle 1",
          mapsUrl: null,
          notes: null,
          status: "CONFIRMED",
        },
      },
      adminId,
    );
    if (!created.ok) throw new Error(created.error);
    const command = {
      id: created.value.id,
      internalName: created.value.internalName,
      slug: created.value.slug,
      startsAt: created.value.startsAt,
      maxPartySize: created.value.maxPartySize,
      opensAt: created.value.opensAt,
      closesAt: created.value.closesAt,
      autoCloseOnFull: created.value.autoCloseOnFull,
      waitlistCapacity: created.value.waitlistCapacity,
      location: { ...created.value.location, address: "Calle vieja" },
      expectedLocation: { revision: 0, status: "CONFIRMED" as const },
    };

    const fresh = await repository.update(
      { ...command, location: { ...command.location, address: "Calle 2" } },
      adminId,
    );
    expect(fresh.ok && fresh.value.locationRevision).toBe(1);

    expectError(await repository.update(command, adminId), "LOCATION_CHANGED");
    expectError(
      await repository.setLocationStatus(
        created.value.id,
        "PENDING",
        { revision: 0, status: "CONFIRMED" },
        adminId,
      ),
      "LOCATION_CHANGED",
    );

    await repository.setLocationStatus(
      created.value.id,
      "PENDING",
      { revision: 1, status: "CONFIRMED" },
      adminId,
    );
    expectError(
      await repository.update(
        { ...command, expectedLocation: { revision: 1, status: "CONFIRMED" } },
        adminId,
      ),
      "LOCATION_CHANGED",
    );
    const stored = await pool.query(
      "SELECT location_address, location_status FROM events WHERE id = $1",
      [created.value.id],
    );
    expect(stored.rows[0]).toEqual({ location_address: "Calle 2", location_status: "PENDING" });
  });

  it("rejects incomplete confirmed locations in the domain and database", async () => {
    expectError(
      await repository.create(
        { ...baseCommand, location: { ...baseCommand.location, status: "CONFIRMED" } },
        adminId,
      ),
      "LOCATION_CONFIRMATION_INCOMPLETE",
    );
    const created = await repository.create({ ...baseCommand, slug: "db-location-check" }, adminId);
    if (!created.ok) throw new Error(created.error);
    await expect(
      pool.query(
        `UPDATE events
            SET location_status = 'CONFIRMED', location_confirmed_at = clock_timestamp()
          WHERE id = $1`,
        [created.value.id],
      ),
    ).rejects.toMatchObject({ constraint: "events_location_confirmation_complete_chk" });
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
      waitlistCapacity: 3,
      location: baseCommand.location,
      expectedLocation: { revision: 0, status: baseCommand.location.status },
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

describe("waitlist capacity changes", () => {
  it("raises and lowers the limit and writes EVENT_UPDATED audit metadata", async () => {
    const id = await insertEvent("DRAFT");
    await pool.query("UPDATE events SET waitlist_capacity = 2 WHERE id = $1", [id]);

    const raised = await repository.changeWaitlistCapacity(id, 5, adminId);
    expect(raised.ok && raised.value.waitlistCapacity).toBe(5);
    const lowered = await repository.changeWaitlistCapacity(id, 1, adminId);
    expect(lowered.ok && lowered.value.waitlistCapacity).toBe(1);

    const audits = await auditFor(id);
    expect(audits.rows.map((row) => ({ action: row.action, metadata: row.metadata }))).toEqual([
      {
        action: "EVENT_UPDATED",
        metadata: { waitlistCapacity: { from: 2, to: 5 } },
      },
      {
        action: "EVENT_UPDATED",
        metadata: { waitlistCapacity: { from: 5, to: 1 } },
      },
    ]);
  });

  it("rejects a limit below the number currently waiting", async () => {
    const id = await insertEvent("SCHEDULED");
    await pool.query(
      "UPDATE events SET waitlist_capacity = 5, waitlisted_count = 2 WHERE id = $1",
      [id],
    );

    expectError(
      await repository.changeWaitlistCapacity(id, 1, adminId),
      "WAITLIST_CAPACITY_BELOW_WAITING",
    );
    const stored = await pool.query<{ waitlist_capacity: number }>(
      "SELECT waitlist_capacity FROM events WHERE id = $1",
      [id],
    );
    expect(stored.rows[0]!.waitlist_capacity).toBe(5);
  });

  it.each(["COMPLETED", "CANCELLED"] as const)("rejects changes for %s events", async (status) => {
    const id = await insertEvent(status);

    expectError(await repository.changeWaitlistCapacity(id, 5, adminId), "INVALID_TRANSITION");
  });

  it("changes a full event to the WAITLIST phase after raising the queue limit", async () => {
    const id = await insertEvent("SCHEDULED", {
      capacity: 2,
      maxPartySize: 1,
      opensAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 60_000),
    });
    await pool.query(
      "UPDATE events SET reserved_seats = capacity, waitlist_capacity = 0 WHERE id = $1",
      [id],
    );

    const changed = await repository.changeWaitlistCapacity(id, 3, adminId);
    expect(changed.ok).toBe(true);
    const readModel = await repository.getAdminEvent(id);
    expect(readModel.value?.phase).toBe("WAITLIST");
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
    await pool.query(
      `UPDATE events
          SET reserved_seats = 1,
              location_name = 'Private venue',
              location_address = 'Private address',
              location_maps_url = 'https://maps.app.goo.gl/private',
              location_notes = 'Private notes'
        WHERE id = $1`,
      [open],
    );
    const full = await insertEvent("SCHEDULED", {
      slug: "full-event",
      opensAt: new Date(Date.now() - 3_600_000),
      closesAt: new Date(Date.now() + 3_600_000),
      capacity: 1,
      maxPartySize: 1,
    });
    await pool.query("UPDATE events SET reserved_seats = 1, waitlist_capacity = 0 WHERE id = $1", [
      full,
    ]);
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
    const publicDetail = await repository.getPublicEventBySlug("open-event");
    expect(Object.keys(publicDetail.value!).sort()).toEqual([
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

  it("lists every roster view with live queue positions and the latest email state", async () => {
    const eventId = await insertEvent("SCHEDULED");
    const reservationIds = [randomUUID(), randomUUID(), randomUUID()];
    await pool.query(
      `INSERT INTO reservations (
         id, event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at,
         accepted_at, cancelled_at
       ) VALUES
         ($2, $1, 1, 'CONFIRMED', 'Confirmada', 'confirmada', '+50371000001', 'c@example.com', 'c@example.com', 1, now(), $5, now() - interval '5 minutes', now(), NULL),
         ($3, $1, NULL, 'FULL_REJECTED', 'Rechazada', 'rechazada', '+50371000002', 'r@example.com', 'r@example.com', 2, now(), $6, now() - interval '4 minutes', NULL, NULL),
         ($4, $1, 2, 'CANCELLED', 'Cancelada', 'cancelada', '+50371000003', 'x@example.com', 'x@example.com', 1, now(), $7, now() - interval '3 minutes', now(), now())`,
      [eventId, ...reservationIds, randomUUID(), randomUUID(), randomUUID()],
    );
    const waitingOne = randomUUID();
    const waitingTwo = randomUUID();
    const cancelled = randomUUID();
    await pool.query(
      `INSERT INTO waitlist_entries (
         id, event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at,
         cancelled_at
       ) VALUES
         ($2, $1, 2, 'WAITING', 'Primera', 'primera', '+50372000001', 'w1@example.com', 'w1@example.com', 1, now(), $5, now() - interval '2 minutes', NULL),
         ($3, $1, 5, 'WAITING', 'Segunda', 'segunda', '+50372000002', 'w2@example.com', 'w2@example.com', 1, now(), $6, now() - interval '1 minute', NULL),
         ($4, $1, 3, 'CANCELLED', 'Retirada', 'retirada', '+50372000003', 'wc@example.com', 'wc@example.com', 1, now(), $7, now(), now())`,
      [eventId, waitingOne, waitingTwo, cancelled, randomUUID(), randomUUID(), randomUUID()],
    );
    await pool.query(
      `INSERT INTO email_outbox (
         kind, waitlist_entry_id, status, attempts, last_error, created_at
       ) VALUES
         ('RESERVATION_WAITLISTED', $1, 'PENDING', 0, NULL, now() - interval '2 minutes'),
         ('WAITLIST_CANCELLED', $1, 'FAILED', 1, 'HTTP_400', now() - interval '1 minute')`,
      [waitingOne],
    );

    const confirmed = await repository.listEventRoster(eventId, "confirmadas");
    const waiting = await repository.listEventRoster(eventId, "en-cola");
    const rejected = await repository.listEventRoster(eventId, "rechazadas");
    const cancelledRows = await repository.listEventRoster(eventId, "canceladas");
    const all = await repository.listEventRoster(eventId, "todas");
    const counts = await repository.countEventRoster(eventId);

    expect(confirmed.value.map((row) => row.fullName)).toEqual(["Confirmada"]);
    expect(waiting.value.map((row) => [row.fullName, row.queuePosition])).toEqual([
      ["Primera", 1],
      ["Segunda", 2],
    ]);
    expect(waiting.value[0]).toMatchObject({
      emailStatus: "FAILED",
      emailLastError: "HTTP_400",
    });
    expect(rejected.value.map((row) => row.fullName)).toEqual(["Rechazada"]);
    expect(cancelledRows.value.map((row) => row.fullName).sort()).toEqual([
      "Cancelada",
      "Retirada",
    ]);
    expect(all.value).toHaveLength(6);
    expect(counts).toEqual({
      confirmadas: 1,
      "en-cola": 2,
      rechazadas: 1,
      canceladas: 2,
      todas: 6,
    });
  });
});
