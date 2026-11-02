import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addConsumption,
  loadEventEconomy,
  reopenTab,
  settleTab,
  voidConsumption,
} from "@/application/economy/economy-use-cases";
import { PostgresEconomyRepository } from "@/infrastructure/db/repositories/postgres-economy-repository";

import { insertAdminUser, insertGuestReservation } from "../helpers/guest-flow-test-data";
import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase } from "../helpers/test-db";

const PARALLEL_REQUESTS = 20;

let pool: Pool;
let economy: PostgresEconomyRepository;
let adminId: string;
let eventId: string;
let reservationId: string;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  pool = database.pool;
  economy = new PostgresEconomyRepository(pool);
  adminId = await insertAdminUser(pool);
  eventId = (await insertTestEvent(pool)).id;
  reservationId = await insertGuestReservation(pool, eventId);
});

afterAll(async () => {
  await pool.end();
});

describe("economy concurrency", () => {
  it("stores every parallel line of one tab and sums them exactly", async () => {
    const results = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, (_, index) =>
        addConsumption(economy, {
          eventId,
          reservationId,
          slot: 1,
          source: "CUSTOM",
          customName: `Consumo ${index}`,
          customPriceCents: 100 + index,
          quantity: 2,
          adminId,
        }),
      ),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    const { guests, eventTotalCents } = await loadEventEconomy(economy, eventId);
    const expectedTotal = Array.from(
      { length: PARALLEL_REQUESTS },
      (_, index) => (100 + index) * 2,
    ).reduce((sum, cents) => sum + cents, 0);
    expect(guests).toHaveLength(1);
    expect(guests[0]!.lines).toHaveLength(PARALLEL_REQUESTS);
    expect(guests[0]!.totalCents).toBe(expectedTotal);
    expect(eventTotalCents).toBe(expectedTotal);
    const audit = await pool.query(
      "SELECT 1 FROM audit_logs WHERE action = 'CONSUMPTION_ADDED' AND metadata->>'eventId' = $1",
      [eventId],
    );
    expect(audit.rowCount).toBe(PARALLEL_REQUESTS);
  });

  it("voids a line exactly once when many admins void it together", async () => {
    const added = await addConsumption(economy, {
      eventId,
      reservationId,
      slot: 1,
      source: "CUSTOM",
      customName: "Duplicado",
      customPriceCents: 700,
      quantity: 1,
      adminId,
    });
    if (!added.ok) throw new Error("The line was not added");

    const results = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () =>
        voidConsumption(economy, { eventId, consumptionId: added.line.id, adminId }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.code === "ALREADY_VOIDED")).toHaveLength(
      PARALLEL_REQUESTS - 1,
    );
    const audit = await pool.query(
      "SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'CONSUMPTION_VOIDED'",
      [added.line.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("settles a tab once and reopens it once under parallel requests", async () => {
    const tab = { eventId, reservationId, slot: 1 as const, adminId };

    const settled = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () => settleTab(economy, tab)),
    );
    expect(settled.every((result) => result.ok)).toBe(true);
    expect(settled.filter((result) => result.ok && result.changed)).toHaveLength(1);

    const reopened = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () => reopenTab(economy, tab)),
    );
    expect(reopened.every((result) => result.ok)).toBe(true);
    expect(reopened.filter((result) => result.ok && result.changed)).toHaveLength(1);

    const tabs = await pool.query("SELECT settled_at FROM guest_tabs WHERE reservation_id = $1", [
      reservationId,
    ]);
    expect(tabs.rowCount).toBe(1);
    expect(tabs.rows[0].settled_at).toBeNull();
  });
});
