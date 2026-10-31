import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PostgresLocationMessageRepository,
  queueLocationMessage,
} from "@/infrastructure/db/repositories/postgres-location-message-repository";
import { PostgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import {
  inEventLock,
  insertAdminUser,
  insertGuestReservation,
  insertLocationEvent,
  listLocationMessages,
} from "../helpers/guest-flow-test-data";
import { resetTestDatabase } from "../helpers/test-db";

const ROUNDS = 15;
const PAID_GUESTS = 8;

let pool: Pool;
let repository: PostgresLocationMessageRepository;
let eventRepository: PostgresEventRepository;
let allocationRepository: PostgresReservationAllocationRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  repository = new PostgresLocationMessageRepository(pool);
  eventRepository = new PostgresEventRepository(pool);
  allocationRepository = new PostgresReservationAllocationRepository(pool);
  adminId = await insertAdminUser(pool, "Admin Concurrencia");
});

afterAll(async () => {
  await pool.end();
});

function barrier() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

async function insertPaidEvent(guests = PAID_GUESTS): Promise<{ eventId: string; paid: string[] }> {
  const eventId = await insertLocationEvent(pool);
  const paid: string[] = [];
  for (let index = 0; index < guests; index += 1) {
    paid.push(await insertGuestReservation(pool, eventId));
  }
  return { eventId, paid };
}

async function editLocationNotes(eventId: string, notes: string) {
  const event = await pool.query<{
    internal_name: string;
    slug: string;
    starts_at: Date;
    max_party_size: number;
    opens_at: Date;
    closes_at: Date;
    auto_close_on_full: boolean;
    location_name: string | null;
    location_address: string | null;
    location_maps_url: string | null;
  }>(
    `SELECT internal_name, slug, starts_at, max_party_size, opens_at, closes_at,
            auto_close_on_full, location_name, location_address, location_maps_url
       FROM events WHERE id = $1`,
    [eventId],
  );
  const row = event.rows[0]!;
  return eventRepository.update(
    {
      id: eventId,
      internalName: row.internal_name,
      slug: row.slug,
      startsAt: row.starts_at,
      maxPartySize: row.max_party_size,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      autoCloseOnFull: row.auto_close_on_full,
      location: {
        name: row.location_name,
        address: row.location_address,
        mapsUrl: row.location_maps_url,
        notes,
        status: "CONFIRMED",
      },
      keepMapsUrl: false,
      coordinates: null,
      expectedLocation: { revision: 0, status: "CONFIRMED" },
    },
    adminId,
  );
}

describe("location messages under concurrent event changes", () => {
  it("a bulk send racing a location edit never queues a stale revision as current", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { eventId } = await insertPaidEvent();
      const gate = barrier();
      const bulkSend = (async () => {
        await gate.opened;
        return repository.sendLocationToPaidGuests(
          eventId,
          { revision: 0, status: "CONFIRMED" },
          adminId,
        );
      })();
      const edit = (async () => {
        await gate.opened;
        return editLocationNotes(eventId, "Puerta azul al fondo");
      })();
      gate.release();
      const [sendResult, editResult] = await Promise.all([bulkSend, edit]);

      expect(editResult.ok).toBe(true);
      const rows = await listLocationMessages(pool, eventId);
      for (const row of rows) {
        expect(row.body.includes("Puerta azul al fondo")).toBe(row.location_revision === 1);
        expect(row.body.includes("Toca el timbre")).toBe(row.location_revision === 0);
      }
      if (sendResult.ok) {
        expect(rows).toHaveLength(PAID_GUESTS);
        expect(rows.every((row) => row.location_revision === 0)).toBe(true);
      } else {
        expect(sendResult).toEqual({ ok: false, error: "LOCATION_CHANGED" });
        expect(rows).toEqual([]);
      }

      const followUp = await repository.sendLocationToPaidGuests(
        eventId,
        { revision: 1, status: "CONFIRMED" },
        adminId,
      );
      expect(followUp.ok && followUp.messageIds).toHaveLength(PAID_GUESTS);
      const current = (await listLocationMessages(pool, eventId)).filter(
        (row) => row.location_revision === 1,
      );
      expect(current).toHaveLength(PAID_GUESTS);
      expect(new Set(current.map((row) => row.reservation_id)).size).toBe(PAID_GUESTS);
    }
  });

  it("a bulk send racing a cancellation never queues for a reservation already cancelled", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { eventId, paid } = await insertPaidEvent();
      const victim = paid[round % paid.length]!;
      const gate = barrier();
      const bulkSend = (async () => {
        await gate.opened;
        return repository.sendLocationToPaidGuests(
          eventId,
          { revision: 0, status: "CONFIRMED" },
          adminId,
        );
      })();
      const cancellation = (async () => {
        await gate.opened;
        return allocationRepository.cancelReservation({
          reservationId: victim,
          actorAdminId: adminId,
        });
      })();
      gate.release();
      const [sendResult, cancelResult] = await Promise.all([bulkSend, cancellation]);

      expect(sendResult.ok).toBe(true);
      expect(cancelResult).toBe("CANCELLED");
      const late = await pool.query<{ violations: number }>(
        `SELECT count(*)::int AS violations
           FROM messages m
           JOIN reservations r ON r.id = m.reservation_id
          WHERE m.event_id = $1
            AND m.kind = 'LOCATION'
            AND r.status = 'CANCELLED'
            AND m.created_at > r.cancelled_at`,
        [eventId],
      );
      expect(late.rows[0]!.violations).toBe(0);
      const rows = await listLocationMessages(pool, eventId);
      const survivors = rows.filter((row) => row.reservation_id !== victim);
      expect(survivors).toHaveLength(PAID_GUESTS - 1);
      expect(rows.length).toBeLessThanOrEqual(PAID_GUESTS);
    }
  });

  it("payments queueing their own location while a bulk send runs leave one message per guest", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { eventId } = await insertPaidEvent(6);
      const paying: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        paying.push(await insertGuestReservation(pool, eventId, { stage: "ON_LIST" }));
      }
      const gate = barrier();
      const bulkSend = (async () => {
        await gate.opened;
        return repository.sendLocationToPaidGuests(
          eventId,
          { revision: 0, status: "CONFIRMED" },
          adminId,
        );
      })();
      const payments = paying.map(async (reservationId) => {
        await gate.opened;
        return inEventLock(pool, eventId, async (client) => {
          await client.query(
            "UPDATE reservations SET stage = 'PAID', paid_at = clock_timestamp() WHERE id = $1",
            [reservationId],
          );
          return queueLocationMessage(client, eventId, reservationId);
        });
      });
      gate.release();
      const [sendResult, ...paymentResults] = await Promise.all([bulkSend, ...payments]);

      expect(sendResult.ok).toBe(true);
      expect(paymentResults.every((result) => result.outcome === "QUEUED")).toBe(true);
      const rows = await listLocationMessages(pool, eventId);
      expect(rows).toHaveLength(10);
      expect(new Set(rows.map((row) => row.reservation_id)).size).toBe(10);
      await expect(
        repository.sendLocationToPaidGuests(eventId, { revision: 0, status: "CONFIRMED" }, adminId),
      ).resolves.toEqual({ ok: true, messageIds: [], locationRevision: 0 });
    }
  });
});
