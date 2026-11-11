import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addConsumption,
  loadEventEconomy,
  reopenTab,
  settleTab,
  voidConsumption,
} from "@/application/economy/economy-use-cases";
import type { AddConsumptionResult } from "@/application/economy/economy-repository";
import { PostgresEconomyRepository } from "@/infrastructure/db/repositories/postgres-economy-repository";
import { PostgresExtraRepository } from "@/infrastructure/db/repositories/postgres-extra-repository";
import { PostgresPersonalDataRetentionRepository } from "@/infrastructure/db/repositories/postgres-personal-data-retention-repository";

import { insertAdminUser, insertGuestReservation } from "../helpers/guest-flow-test-data";
import { insertTestEvent } from "../helpers/reservation-test-data";
import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let economy: PostgresEconomyRepository;
let extras: PostgresExtraRepository;
let adminId: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  economy = new PostgresEconomyRepository(pool);
  extras = new PostgresExtraRepository(pool);
  adminId = await insertAdminUser(pool);
});

afterAll(async () => {
  await pool.end();
});

async function newEvent(): Promise<string> {
  return (await insertTestEvent(pool)).id;
}

async function insertDrink(name: string, priceCents: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO drinks (name, price_cents, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [name, priceCents, adminId],
  );
  return result.rows[0]!.id;
}

async function insertExtra(name: string, priceCents: number): Promise<string> {
  const extra = await extras.create({
    name,
    priceCents,
    isActive: true,
    sortOrder: 0,
    actorId: adminId,
  });
  return extra.id;
}

async function insertGroupReservation(eventId: string, names: readonly string[]): Promise<string> {
  const reservationId = await insertGuestReservation(pool, eventId, { guest2FullName: names[1] });
  await pool.query("UPDATE reservations SET party_size = $2 WHERE id = $1", [
    reservationId,
    names.length,
  ]);
  for (let index = 2; index < names.length; index += 1) {
    await pool.query(
      `INSERT INTO request_guests (reservation_id, slot, full_name, instagram_handle)
       VALUES ($1, $2, $3, $4)`,
      [reservationId, index + 1, names[index], `grupo.${randomUUID().slice(0, 8)}`],
    );
  }
  return reservationId;
}

function addCustom(
  eventId: string,
  reservationId: string,
  slot: number,
  customName: string,
  customPriceCents: number,
  quantity = 1,
): Promise<AddConsumptionResult> {
  return addConsumption(economy, {
    eventId,
    reservationId,
    slot,
    source: "CUSTOM",
    customName,
    customPriceCents,
    quantity,
    adminId,
  });
}

function addCatalog(
  eventId: string,
  reservationId: string,
  slot: number,
  source: "DRINK" | "EXTRA",
  itemId: string,
  quantity = 1,
): Promise<AddConsumptionResult> {
  return addConsumption(economy, {
    eventId,
    reservationId,
    slot,
    source,
    itemId,
    quantity,
    adminId,
  });
}

function lineIdOf(result: AddConsumptionResult): string {
  if (!result.ok) throw new Error(`Expected an added line, got ${result.code}`);
  return result.line.id;
}

async function auditMetadata(entityIds: string[]): Promise<string[]> {
  const result = await pool.query<{ metadata: unknown }>(
    "SELECT metadata FROM audit_logs WHERE entity_id = ANY($1::uuid[]) ORDER BY id",
    [entityIds],
  );
  return result.rows.map((row) => JSON.stringify(row.metadata));
}

async function auditActions(entityId: string): Promise<string[]> {
  const result = await pool.query<{ action: string }>(
    "SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id",
    [entityId],
  );
  return result.rows.map((row) => row.action);
}

describe("event economy", () => {
  it("computes guest and event totals from mixed lines and ignores voided ones", async () => {
    const eventId = await newEvent();
    const couple = await insertGuestReservation(pool, eventId, {
      stage: "PAID",
      guest2FullName: "Beto Cliente",
    });
    const solo = await insertGuestReservation(pool, eventId, { stage: "ON_LIST" });
    const drinkId = await insertDrink("Vino", 450);
    const extraId = await insertExtra("Pan", 300);

    await addCatalog(eventId, couple, 1, "DRINK", drinkId, 2);
    await addCatalog(eventId, couple, 1, "EXTRA", extraId, 1);
    const custom = await addCustom(eventId, couple, 1, "Postre especial", 1000, 3);
    const wrong = await addCustom(eventId, couple, 1, "Linea equivocada", 5000, 1);
    await addCustom(eventId, couple, 2, "Agua", 100, 4);
    await addCustom(eventId, solo, 1, "Cafe", 250, 2);
    await voidConsumption(economy, {
      eventId,
      consumptionId: lineIdOf(wrong),
      adminId,
    });

    const snapshot = await loadEventEconomy(economy, eventId);

    expect(snapshot.guests.map((guest) => [guest.reservationId, guest.slot])).toEqual([
      [couple, 1],
      [couple, 2],
      [solo, 1],
    ]);
    const [first, second, third] = snapshot.guests;
    expect(first!.totalCents).toBe(450 * 2 + 300 + 1000 * 3);
    expect(first!.lines).toHaveLength(4);
    expect(first!.lines.find((line) => line.id === lineIdOf(wrong))?.voidedAt).toBeInstanceOf(Date);
    expect(first!.lines.find((line) => line.id === lineIdOf(custom))?.totalCents).toBe(3000);
    expect(second!.totalCents).toBe(400);
    expect(second!.fullName).toBe("Beto Cliente");
    expect(third!.totalCents).toBe(500);
    expect(snapshot.eventTotalCents).toBe(4200 + 400 + 500);
  });

  it("returns an empty economy for an event without eligible guests", async () => {
    const eventId = await newEvent();
    await insertGuestReservation(pool, eventId, { stage: "IN_REVIEW" });

    expect(await loadEventEconomy(economy, eventId)).toEqual({ eventTotalCents: 0, guests: [] });
  });

  it("keeps the price and name captured when a line was added", async () => {
    const eventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId);
    const drinkId = await insertDrink("Cerveza", 400);
    const extraId = await insertExtra("Servilletas", 150);
    await addCatalog(eventId, reservationId, 1, "DRINK", drinkId, 1);
    await addCatalog(eventId, reservationId, 1, "EXTRA", extraId, 1);

    await pool.query(
      "UPDATE drinks SET name = 'Cerveza artesanal', price_cents = 900 WHERE id = $1",
      [drinkId],
    );
    await extras.update({
      id: extraId,
      name: "Servilletas finas",
      priceCents: 700,
      isActive: true,
      sortOrder: 0,
      actorId: adminId,
    });

    const [guest] = (await loadEventEconomy(economy, eventId)).guests;
    expect(guest!.lines.map((line) => [line.itemName, line.unitPriceCents])).toEqual([
      ["Cerveza", 400],
      ["Servilletas", 150],
    ]);
    expect(guest!.totalCents).toBe(550);
  });

  it("keeps the line when its drink is deleted from the menu", async () => {
    const eventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId);
    const drinkId = await insertDrink("Mezcal", 800);
    await addCatalog(eventId, reservationId, 1, "DRINK", drinkId, 1);

    await pool.query("DELETE FROM drinks WHERE id = $1", [drinkId]);

    const [guest] = (await loadEventEconomy(economy, eventId)).guests;
    expect(guest!.lines.map((line) => [line.itemName, line.source])).toEqual([["Mezcal", "DRINK"]]);
  });

  it("rejects lines for guests that are not on the list of this event", async () => {
    const eventId = await newEvent();
    const otherEventId = await newEvent();
    const solo = await insertGuestReservation(pool, eventId);
    const other = await insertGuestReservation(pool, otherEventId);
    const inReview = await insertGuestReservation(pool, eventId, { stage: "IN_REVIEW" });
    const cancelled = await insertGuestReservation(pool, eventId, { status: "CANCELLED" });

    const results = await Promise.all([
      addCustom(eventId, solo, 2, "Agua", 100),
      addCustom(eventId, other, 1, "Agua", 100),
      addCustom(eventId, inReview, 1, "Agua", 100),
      addCustom(eventId, cancelled, 1, "Agua", 100),
      addCustom(eventId, randomUUID(), 1, "Agua", 100),
    ]);

    expect(results).toEqual(results.map(() => ({ ok: false, code: "GUEST_NOT_FOUND" })));
    const { guests } = await loadEventEconomy(economy, eventId);
    expect(guests.map((guest) => guest.reservationId)).toEqual([solo]);
    const stored = await pool.query("SELECT 1 FROM guest_consumptions WHERE event_id = $1", [
      eventId,
    ]);
    expect(stored.rowCount).toBe(0);
  });

  it("does not list guests of a deleted event", async () => {
    const eventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId);
    await pool.query("UPDATE events SET deleted_at = now() WHERE id = $1", [eventId]);

    expect((await loadEventEconomy(economy, eventId)).guests).toEqual([]);
    expect(await addCustom(eventId, reservationId, 1, "Agua", 100)).toEqual({
      ok: false,
      code: "GUEST_NOT_FOUND",
    });
  });

  it("rejects invalid quantities, prices and names before touching the database", async () => {
    const eventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId);

    expect(await addCustom(eventId, reservationId, 1, "Agua", 100, 0)).toEqual({
      ok: false,
      code: "INVALID_QUANTITY",
    });
    expect(await addCustom(eventId, reservationId, 1, "Agua", 100, 100)).toEqual({
      ok: false,
      code: "INVALID_QUANTITY",
    });
    expect(await addCustom(eventId, reservationId, 1, "Agua", -1)).toEqual({
      ok: false,
      code: "INVALID_PRICE",
    });
    expect(await addCustom(eventId, reservationId, 1, "Agua", 10_000_001)).toEqual({
      ok: false,
      code: "INVALID_PRICE",
    });
    expect(await addCustom(eventId, reservationId, 1, "Agua", 1.5)).toEqual({
      ok: false,
      code: "INVALID_PRICE",
    });
    expect(await addCustom(eventId, reservationId, 1, "   ", 100)).toEqual({
      ok: false,
      code: "INVALID_NAME",
    });
    expect(await addCustom(eventId, reservationId, 1, "x".repeat(81), 100)).toEqual({
      ok: false,
      code: "INVALID_NAME",
    });
  });

  it("enforces the quantity and price limits in the database too", async () => {
    const eventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId);
    const insertLine = (price: number, quantity: number) =>
      pool.query(
        `INSERT INTO guest_consumptions (
           event_id, reservation_id, guest_slot, source, item_name, unit_price_cents, quantity
         ) VALUES ($1, $2, 1, 'CUSTOM', 'Agua', $3, $4)`,
        [eventId, reservationId, price, quantity],
      );

    await expect(insertLine(100, 0)).rejects.toThrow(/guest_consumptions_quantity_chk/);
    await expect(insertLine(100, 100)).rejects.toThrow(/guest_consumptions_quantity_chk/);
    await expect(insertLine(-1, 1)).rejects.toThrow(/guest_consumptions_unit_price_chk/);
  });

  it("rejects missing, inactive and deleted catalog items", async () => {
    const eventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId);
    const inactive = await extras.create({
      name: "Vela",
      priceCents: 100,
      isActive: false,
      sortOrder: 0,
      actorId: adminId,
    });
    const deletedId = await insertExtra("Mantel", 200);
    await extras.delete(deletedId, adminId);
    const notFound = { ok: false, code: "ITEM_NOT_FOUND" };

    expect(await addCatalog(eventId, reservationId, 1, "DRINK", randomUUID())).toEqual(notFound);
    expect(await addCatalog(eventId, reservationId, 1, "EXTRA", randomUUID())).toEqual(notFound);
    expect(await addCatalog(eventId, reservationId, 1, "EXTRA", inactive.id)).toEqual(notFound);
    expect(await addCatalog(eventId, reservationId, 1, "EXTRA", deletedId)).toEqual(notFound);
  });

  it("voids a line once and reports the second attempt", async () => {
    const eventId = await newEvent();
    const otherEventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId);
    const lineId = lineIdOf(await addCustom(eventId, reservationId, 1, "Agua", 300, 2));

    expect(
      await voidConsumption(economy, { eventId: otherEventId, consumptionId: lineId, adminId }),
    ).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await voidConsumption(economy, { eventId, consumptionId: lineId, adminId })).toEqual({
      ok: true,
    });
    expect(await voidConsumption(economy, { eventId, consumptionId: lineId, adminId })).toEqual({
      ok: false,
      code: "ALREADY_VOIDED",
    });
    expect(
      await voidConsumption(economy, { eventId, consumptionId: randomUUID(), adminId }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });

    const [guest] = (await loadEventEconomy(economy, eventId)).guests;
    expect(guest!.totalCents).toBe(0);
    expect(await auditActions(lineId)).toEqual(["CONSUMPTION_ADDED", "CONSUMPTION_VOIDED"]);
  });

  it("gives every person of a group of 4 a tab with the right name and sums the bill", async () => {
    const eventId = await newEvent();
    const group = await insertGroupReservation(eventId, ["Ana", "Beto", "Carla", "Diego"]);

    expect((await addCustom(eventId, group, 4, "Agua", 100, 3)).ok).toBe(true);
    expect((await addCustom(eventId, group, 3, "Cafe", 250, 2)).ok).toBe(true);
    expect(await addCustom(eventId, group, 5, "Agua", 100)).toEqual({
      ok: false,
      code: "GUEST_NOT_FOUND",
    });

    const snapshot = await loadEventEconomy(economy, eventId);
    expect(snapshot.guests.map((guest) => [guest.slot, guest.fullName])).toEqual([
      [1, "Ana López"],
      [2, "Beto"],
      [3, "Carla"],
      [4, "Diego"],
    ]);
    expect(snapshot.guests.map((guest) => guest.totalCents)).toEqual([0, 0, 500, 300]);
    expect(snapshot.eventTotalCents).toBe(800);
  });

  it("settles and reopens slot 3 of a group and rejects slot 5 on a party of 4", async () => {
    const eventId = await newEvent();
    const group = await insertGroupReservation(eventId, ["Ana", "Beto", "Carla", "Diego"]);
    const tab = { eventId, reservationId: group, slot: 3, adminId };
    const isSettled = async () =>
      (await loadEventEconomy(economy, eventId)).guests.find((guest) => guest.slot === 3)!.settled;

    expect(await settleTab(economy, tab)).toEqual({ ok: true, changed: true });
    expect(await isSettled()).toBe(true);
    expect(await reopenTab(economy, tab)).toEqual({ ok: true, changed: true });
    expect(await isSettled()).toBe(false);
    expect(await settleTab(economy, { ...tab, slot: 5 })).toEqual({
      ok: false,
      code: "GUEST_NOT_FOUND",
    });
  });

  it("settles and reopens a tab idempotently", async () => {
    const eventId = await newEvent();
    const couple = await insertGuestReservation(pool, eventId, { guest2FullName: "Beto" });
    const solo = await insertGuestReservation(pool, eventId);
    const tab = { eventId, reservationId: couple, slot: 2 as const, adminId };
    const isSettled = async () =>
      (await loadEventEconomy(economy, eventId)).guests.find(
        (guest) => guest.reservationId === couple && guest.slot === 2,
      )!.settled;

    expect(await reopenTab(economy, tab)).toEqual({ ok: true, changed: false });
    expect(await settleTab(economy, tab)).toEqual({ ok: true, changed: true });
    expect(await settleTab(economy, tab)).toEqual({ ok: true, changed: false });
    expect(await isSettled()).toBe(true);
    expect(await reopenTab(economy, tab)).toEqual({ ok: true, changed: true });
    expect(await reopenTab(economy, tab)).toEqual({ ok: true, changed: false });
    expect(await isSettled()).toBe(false);
    expect(await settleTab(economy, tab)).toEqual({ ok: true, changed: true });
    expect(await isSettled()).toBe(true);

    expect(await auditActions(couple)).toEqual([
      "GUEST_TAB_SETTLED",
      "GUEST_TAB_REOPENED",
      "GUEST_TAB_SETTLED",
    ]);
    const notFound = { ok: false, code: "GUEST_NOT_FOUND" };
    expect(await settleTab(economy, { eventId, reservationId: solo, slot: 2, adminId })).toEqual(
      notFound,
    );
    expect(await settleTab(economy, { ...tab, eventId: await newEvent() })).toEqual(notFound);
    expect(await reopenTab(economy, { eventId, reservationId: solo, slot: 2, adminId })).toEqual(
      notFound,
    );
  });

  it("writes audit rows without guest names or Instagram users", async () => {
    const eventId = await newEvent();
    const reservationId = await insertGuestReservation(pool, eventId, {
      fullName: "Marta Privadisima",
      guest2FullName: "Nicolas Privadisimo",
    });
    const guestRow = await pool.query<{
      instagram_handle: string;
      guest2_instagram_handle: string;
    }>("SELECT instagram_handle, guest2_instagram_handle FROM reservations WHERE id = $1", [
      reservationId,
    ]);
    const extraId = await insertExtra("Pan", 300);
    const lineId = lineIdOf(await addCatalog(eventId, reservationId, 1, "EXTRA", extraId, 2));
    await voidConsumption(economy, { eventId, consumptionId: lineId, adminId });
    await settleTab(economy, { eventId, reservationId, slot: 2, adminId });
    await reopenTab(economy, { eventId, reservationId, slot: 2, adminId });

    const metadata = (await auditMetadata([extraId, lineId, reservationId])).join("\n");

    expect(metadata).toContain('"itemName":"Pan"');
    expect(metadata).toContain('"quantity":2');
    expect(metadata).not.toMatch(/Privadisim/);
    expect(metadata).not.toContain(guestRow.rows[0]!.instagram_handle);
    expect(metadata).not.toContain(guestRow.rows[0]!.guest2_instagram_handle);
    const actions = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE entity_id = ANY($1::uuid[]) AND actor_admin_id = $2 ORDER BY id`,
      [[extraId, lineId, reservationId], adminId],
    );
    expect(actions.rows.map((row) => row.action)).toEqual([
      "EXTRA_CREATED",
      "CONSUMPTION_ADDED",
      "CONSUMPTION_VOIDED",
      "GUEST_TAB_SETTLED",
      "GUEST_TAB_REOPENED",
    ]);
  });
});

describe("extras catalog", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM extras");
  });

  it("creates, updates, lists and soft deletes extras with audit rows", async () => {
    const created = await extras.create({
      name: "Cubiertos",
      priceCents: 0,
      isActive: true,
      sortOrder: 2,
      actorId: adminId,
    });
    const hidden = await extras.create({
      name: "Servicio",
      priceCents: 500,
      isActive: false,
      sortOrder: 1,
      actorId: adminId,
    });

    const updated = await extras.update({
      id: created.id,
      name: "Cubiertos extra",
      priceCents: 150,
      isActive: true,
      sortOrder: 0,
      actorId: adminId,
    });

    expect(updated).toMatchObject({ name: "Cubiertos extra", priceCents: 150, sortOrder: 0 });
    expect((await extras.listForAdmin()).map((extra) => extra.id)).toEqual([created.id, hidden.id]);
    expect(await extras.listActive()).toEqual([
      { id: created.id, name: "Cubiertos extra", priceCents: 150 },
    ]);

    expect(await extras.delete(created.id, adminId)).toBe(true);
    expect(await extras.delete(created.id, adminId)).toBe(false);
    expect(await extras.get(created.id)).toBeNull();
    expect(
      await extras.update({
        id: created.id,
        name: "Fantasma",
        priceCents: 1,
        isActive: true,
        sortOrder: 0,
        actorId: adminId,
      }),
    ).toBeNull();
    expect((await extras.listForAdmin()).map((extra) => extra.id)).toEqual([hidden.id]);
    const stored = await pool.query("SELECT deleted_at FROM extras WHERE id = $1", [created.id]);
    expect(stored.rows[0].deleted_at).toBeInstanceOf(Date);
    expect(await auditActions(created.id)).toEqual([
      "EXTRA_CREATED",
      "EXTRA_UPDATED",
      "EXTRA_DELETED",
    ]);
  });

  it("rejects a negative price and an empty name in the database", async () => {
    await expect(
      extras.create({
        name: "Mal",
        priceCents: -1,
        isActive: true,
        sortOrder: 0,
        actorId: adminId,
      }),
    ).rejects.toThrow(/extras_price_cents_chk/);
    await expect(
      extras.create({ name: "", priceCents: 1, isActive: true, sortOrder: 0, actorId: adminId }),
    ).rejects.toThrow(/extras_name_length_chk/);
  });
});

describe("retention with consumption lines", () => {
  it("anonymizes an expired event and keeps its consumption lines and tabs", async () => {
    const eventId = (
      await pool.query<{ id: string }>(
        `INSERT INTO events (
           slug, internal_name, starts_at, capacity, max_party_size, opens_at, closes_at, status
         ) VALUES ($1, 'Retencion', now() - interval '91 days', 50, 2,
                   now() - interval '100 days', now() - interval '99 days', 'COMPLETED')
         RETURNING id`,
        [`retention-${randomUUID()}`],
      )
    ).rows[0]!.id;
    const reservationId = await insertGuestReservation(pool, eventId);
    await addCustom(eventId, reservationId, 1, "Agua", 100, 2);
    await settleTab(economy, { eventId, reservationId, slot: 1, adminId });

    const purged = await new PostgresPersonalDataRetentionRepository(pool).purgeEvent(eventId);

    expect(purged).toBe(true);
    const lines = await pool.query("SELECT 1 FROM guest_consumptions WHERE event_id = $1", [
      eventId,
    ]);
    expect(lines.rowCount).toBe(1);
    const tabs = await pool.query("SELECT 1 FROM guest_tabs WHERE reservation_id = $1", [
      reservationId,
    ]);
    expect(tabs.rowCount).toBe(1);
    const reservation = await pool.query<{ full_name: string }>(
      "SELECT full_name FROM reservations WHERE id = $1",
      [reservationId],
    );
    expect(reservation.rows[0]!.full_name).toBe("eliminado");
  });
});
