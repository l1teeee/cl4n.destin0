import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AllocationCommand } from "@/application/ports/reservation-allocation-repository";
import type { CreateEventCommand, EventOperationResult } from "@/application/events/types";
import type { EventLifecycleStatus } from "@/domain/event/event-phase";
import { mapReservationOutcome } from "@/application/reservations/reservation-response";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";
import { PostgresEventLocationEmailRepository } from "@/infrastructure/db/repositories/postgres-event-location-email-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let eventRepository: PostgresEventRepository;
let imageRepository: PostgresEventImageRepository;
let locationEmailRepository: PostgresEventLocationEmailRepository;
let allocationRepository: PostgresReservationAllocationRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
});

beforeEach(async () => {
  await pool.end();
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  eventRepository = new PostgresEventRepository(pool);
  imageRepository = new PostgresEventImageRepository(pool);
  locationEmailRepository = new PostgresEventLocationEmailRepository(pool);
  allocationRepository = new PostgresReservationAllocationRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ('delete@example.com', 'delete@example.com', 'hash', 'Delete Admin')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
});

interface EventOptions {
  slug?: string;
  opensOffset?: string;
  closesOffset?: string;
  capacity?: number;
  reservedSeats?: number;
  waitlistCapacity?: number;
  waitlistedCount?: number;
}

async function insertEvent(status: EventLifecycleStatus, options: EventOptions = {}) {
  const slug = options.slug ?? `delete-${randomUUID()}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, reserved_seats, max_party_size,
       opens_at, closes_at, status, waitlist_capacity, waitlisted_count
     ) VALUES (
       $1, 'Cena eliminable', clock_timestamp() + interval '2 days', $2, $3, 1,
       clock_timestamp() + $4::interval, clock_timestamp() + $5::interval, $6, $7, $8
     ) RETURNING id`,
    [
      slug,
      options.capacity ?? 10,
      options.reservedSeats ?? 0,
      options.opensOffset ?? "1 hour",
      options.closesOffset ?? "1 day",
      status,
      options.waitlistCapacity ?? 5,
      options.waitlistedCount ?? 0,
    ],
  );
  return { id: result.rows[0]!.id, slug };
}

function expectError(result: EventOperationResult<unknown>, error: string): void {
  expect(result).toEqual({ ok: false, error });
}

function allocationCommand(slug: string, sequence: number): AllocationCommand {
  const key = randomUUID();
  return {
    idempotencyKey: key,
    fingerprint: `fingerprint-${key}`,
    eventSlug: slug,
    fullName: `Guest ${sequence}`,
    instagramHandle: `guest.${sequence}`,
    phoneE164: `+5037${String(100_0000 + sequence).slice(-7)}`,
    email: `guest${sequence}@example.com`,
    emailNormalized: `guest${sequence}@example.com`,
    partySize: 1,
    allergies: null,
    mapOutcome: mapReservationOutcome,
  };
}

describe("event soft deletion", () => {
  it.each([
    ["DRAFT", "1 hour", "1 day"],
    ["SCHEDULED", "1 hour", "1 day"],
    ["CLOSED", "-2 hours", "-1 hour"],
    ["COMPLETED", "-2 hours", "-1 hour"],
    ["CANCELLED", "-2 hours", "-1 hour"],
  ] as const)("deletes %s and writes one non-PII audit row", async (status, opens, closes) => {
    const event = await insertEvent(status, { opensOffset: opens, closesOffset: closes });

    const result = await eventRepository.delete(event.id, adminId);

    expect(result.ok).toBe(true);
    await expect(
      pool.query("SELECT deleted_at FROM events WHERE id = $1", [event.id]),
    ).resolves.toMatchObject({ rows: [{ deleted_at: expect.any(Date) }] });
    await expect(
      pool.query(
        `SELECT actor_admin_id, action, metadata
           FROM audit_logs
          WHERE entity_id = $1 AND action = 'EVENT_DELETED'`,
        [event.id],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          actor_admin_id: adminId,
          action: "EVENT_DELETED",
          metadata: {
            internalName: "Cena eliminable",
            slug: event.slug,
            status,
            reservedSeats: 0,
          },
        },
      ],
    });
  });

  it.each([
    ["OPEN", { capacity: 2, reservedSeats: 0, waitlistCapacity: 1, waitlistedCount: 0 }],
    ["WAITLIST", { capacity: 1, reservedSeats: 1, waitlistCapacity: 1, waitlistedCount: 0 }],
    ["FULL", { capacity: 1, reservedSeats: 1, waitlistCapacity: 0, waitlistedCount: 0 }],
  ] as const)("rejects deletion while the derived phase is %s", async (_phase, counts) => {
    const event = await insertEvent("SCHEDULED", {
      opensOffset: "-1 hour",
      closesOffset: "1 hour",
      ...counts,
    });

    expectError(await eventRepository.delete(event.id, adminId), "EVENT_ACCEPTING_RESERVATIONS");
    await expect(
      pool.query("SELECT deleted_at FROM events WHERE id = $1", [event.id]),
    ).resolves.toMatchObject({ rows: [{ deleted_at: null }] });
    expect(
      (
        await pool.query(
          "SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'EVENT_DELETED'",
          [event.id],
        )
      ).rowCount,
    ).toBe(0);
  });

  it("hides deleted events and makes every event mutation return not found", async () => {
    const event = await insertEvent("DRAFT", { slug: "hidden-event" });
    const detail = await eventRepository.getAdminEvent(event.id);
    const record = detail.value!;
    expect((await eventRepository.delete(event.id, adminId)).ok).toBe(true);

    expect((await eventRepository.listAdminEvents()).value).toEqual([]);
    expect((await eventRepository.getAdminEvent(event.id)).value).toBeNull();
    expect((await eventRepository.getPublicHomeEvents()).value).toEqual([]);
    expect((await eventRepository.getPublicEventBySlug(event.slug)).value).toBeNull();

    const update = eventRepository.update(
      {
        id: record.id,
        internalName: record.internalName,
        slug: record.slug,
        startsAt: record.startsAt,
        maxPartySize: record.maxPartySize,
        opensAt: record.opensAt,
        closesAt: record.closesAt,
        autoCloseOnFull: record.autoCloseOnFull,
        location: record.location,
        keepMapsUrl: false,
        coordinates: null,
        expectedLocation: { revision: record.locationRevision, status: record.location.status },
      },
      adminId,
    );
    const results = await Promise.all([
      update,
      eventRepository.publish(event.id, adminId),
      eventRepository.openNow(event.id, adminId),
      eventRepository.closeNow(event.id, adminId),
      eventRepository.complete(event.id, adminId),
      eventRepository.cancel(event.id, adminId),
      eventRepository.changeCapacity(event.id, 12, adminId),
      eventRepository.changeWaitlistCapacity(event.id, 6, adminId),
      eventRepository.setLocationStatus(
        event.id,
        "PENDING",
        { revision: 0, status: "PENDING" },
        adminId,
      ),
      eventRepository.delete(event.id, adminId),
    ]);
    for (const result of results) {
      expectError(result, "EVENT_NOT_FOUND");
    }
    await expect(
      imageRepository.add({
        eventId: event.id,
        contentType: "image/webp",
        data: new Uint8Array([1]),
        actorId: adminId,
      }),
    ).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
    await expect(
      locationEmailRepository.queue(event.id, { revision: 0, status: "PENDING" }, adminId),
    ).resolves.toEqual({ ok: false, error: "EVENT_NOT_FOUND" });
  });

  it("keeps reservations and waitlist rows but cancellation treats them as not found", async () => {
    const event = await insertEvent("DRAFT");
    const reservation = await pool.query<{ id: string }>(
      `INSERT INTO reservations (
         event_id, reservation_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key,
         submitted_at, accepted_at
       ) VALUES (
         $1, 1, 'CONFIRMED', 'Ana', 'ana', '+50371000001', 'ana@example.com',
         'ana@example.com', 1, now(), $2, now(), now()
       ) RETURNING id`,
      [event.id, randomUUID()],
    );
    const waiting = await pool.query<{ id: string }>(
      `INSERT INTO waitlist_entries (
         event_id, waitlist_number, status, full_name, instagram_handle, phone_e164,
         email, email_normalized, party_size, terms_accepted_at, idempotency_key, submitted_at
       ) VALUES (
         $1, 1, 'WAITING', 'Beto', 'beto', '+50371000002', 'beto@example.com',
         'beto@example.com', 1, now(), $2, now()
       ) RETURNING id`,
      [event.id, randomUUID()],
    );
    await pool.query(
      `UPDATE events
          SET reserved_seats = 1, last_reservation_number = 1,
              waitlisted_count = 1, last_waitlist_number = 1
        WHERE id = $1`,
      [event.id],
    );
    await eventRepository.delete(event.id, adminId);

    expect(
      await allocationRepository.cancelReservation({
        reservationId: reservation.rows[0]!.id,
        actorAdminId: adminId,
      }),
    ).toBe("NOT_FOUND");
    expect(
      await allocationRepository.cancelWaitlistEntry({
        waitlistEntryId: waiting.rows[0]!.id,
        actorAdminId: adminId,
      }),
    ).toBe("NOT_FOUND");
    await expect(
      pool.query("SELECT status, party_size FROM reservations WHERE id = $1", [
        reservation.rows[0]!.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ status: "CONFIRMED", party_size: 1 }] });
    await expect(
      pool.query("SELECT status, party_size FROM waitlist_entries WHERE id = $1", [
        waiting.rows[0]!.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ status: "WAITING", party_size: 1 }] });
  });

  it("reuses a deleted slug and allocates only to the live event", async () => {
    const previous = await insertEvent("DRAFT", { slug: "reused-slug" });
    await eventRepository.delete(previous.id, adminId);
    const now = Date.now();
    const command: CreateEventCommand = {
      internalName: "Cena actual",
      slug: previous.slug,
      startsAt: new Date(now + 86_400_000),
      opensAt: new Date(now - 60_000),
      closesAt: new Date(now + 3_600_000),
      capacity: 10,
      maxPartySize: 2,
      autoCloseOnFull: false,
      waitlistCapacity: 2,
      status: "SCHEDULED",
      location: { name: null, address: null, mapsUrl: null, notes: null, status: "PENDING" },
      coordinates: null,
    };
    const current = await eventRepository.create(command, adminId);
    if (!current.ok) throw new Error(current.error);

    const allocation = await allocationRepository.allocate(allocationCommand(previous.slug, 1));

    expect(allocation.status).toBe(201);
    const reservations = await pool.query<{ event_id: string }>(
      "SELECT event_id FROM reservations ORDER BY created_at",
    );
    expect(reservations.rows).toEqual([{ event_id: current.value.id }]);
  });

  it.each([
    ["seat", { capacity: 2, reservedSeats: 0, waitlistCapacity: 1 }],
    ["waitlist", { capacity: 1, reservedSeats: 1, waitlistCapacity: 2 }],
  ] as const)(
    "returns not found without allocating through the deleted %s path",
    async (_path, state) => {
      const event = await insertEvent("SCHEDULED", {
        opensOffset: "1 hour",
        closesOffset: "2 hours",
        ...state,
      });
      await eventRepository.delete(event.id, adminId);
      await pool.query(
        `UPDATE events
          SET opens_at = clock_timestamp() - interval '1 minute',
              closes_at = clock_timestamp() + interval '1 hour'
        WHERE id = $1`,
        [event.id],
      );

      const allocation = await allocationRepository.allocate(allocationCommand(event.slug, 2));

      expect(allocation.status).toBe(404);
      expect(allocation.body).toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
      const stateAfter = await pool.query(
        `SELECT reserved_seats, waitlisted_count,
              (SELECT count(*)::int FROM reservations WHERE event_id = $1) AS reservations,
              (SELECT count(*)::int FROM waitlist_entries WHERE event_id = $1) AS waitlist_entries
         FROM events
        WHERE id = $1`,
        [event.id],
      );
      expect(stateAfter.rows[0]).toMatchObject({
        reserved_seats: state.reservedSeats,
        waitlisted_count: 0,
        reservations: 0,
        waitlist_entries: 0,
      });
    },
  );
});
