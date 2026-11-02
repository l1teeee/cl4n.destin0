import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  AddConsumptionCommand,
  AddConsumptionFailureCode,
  ConsumptionLine,
  EconomyGuest,
  EconomyRepository,
  EventEconomy,
  TabCommand,
  TabReference,
  TabResult,
  VoidConsumptionCommand,
  VoidConsumptionResult,
} from "@/application/economy/economy-repository";
import type { PickerItem } from "@/application/extras/extra-repository";
import {
  lineTotalCents,
  type ConsumptionSource,
  type GuestSlot,
} from "@/domain/economy/consumption";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

interface GuestRow extends QueryResultRow {
  reservation_id: string;
  reservation_number: number;
  slot: GuestSlot;
  full_name: string;
  instagram: string | null;
  stage: "ON_LIST" | "PAID";
  total_cents: string;
  settled_at: Date | null;
  event_total_cents: string;
}

interface LineRow extends QueryResultRow {
  id: string;
  reservation_id: string;
  guest_slot: GuestSlot;
  source: ConsumptionSource;
  item_name: string;
  unit_price_cents: number;
  quantity: number;
  created_at: Date;
  voided_at: Date | null;
}

const writeSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

// Both reads must see the same snapshot so the guest totals match their listed lines.
const readSettings = [
  "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  ...writeSettings,
] as const;

// $1 event id, $2 reservation id, $3 guest slot.
const eligibleGuestSource = `
  FROM reservations r
  JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
 WHERE r.id = $2
   AND r.event_id = $1
   AND r.status = 'CONFIRMED'
   AND r.stage IN ('ON_LIST', 'PAID')
   AND ($3::smallint = 1 OR r.party_size = 2)`;

const itemSources: Record<AddConsumptionCommand["source"], string> = {
  DRINK: `SELECT d.id AS drink_id, NULL::uuid AS extra_id, d.name, d.price_cents
            FROM drinks d WHERE d.id = $7::uuid`,
  EXTRA: `SELECT NULL::uuid AS drink_id, x.id AS extra_id, x.name, x.price_cents
            FROM extras x
           WHERE x.id = $7::uuid AND x.is_active = true AND x.deleted_at IS NULL`,
  CUSTOM: `SELECT NULL::uuid AS drink_id, NULL::uuid AS extra_id,
                  $7::text AS name, $8::integer AS price_cents`,
};

function lineFromRow(row: LineRow): ConsumptionLine {
  return {
    id: row.id,
    source: row.source,
    itemName: row.item_name,
    unitPriceCents: row.unit_price_cents,
    quantity: row.quantity,
    totalCents: lineTotalCents(row.unit_price_cents, row.quantity),
    createdAt: row.created_at,
    voidedAt: row.voided_at,
  };
}

function lineKey(reservationId: string, slot: number): string {
  return `${reservationId}:${slot}`;
}

async function guestExists(client: PoolClient, reference: TabReference): Promise<boolean> {
  const result = await client.query(`SELECT 1 ${eligibleGuestSource}`, [
    reference.eventId,
    reference.reservationId,
    reference.slot,
  ]);
  return result.rowCount === 1;
}

async function insertAudit(
  client: PoolClient,
  adminId: string,
  action: "CONSUMPTION_ADDED" | "CONSUMPTION_VOIDED" | "GUEST_TAB_SETTLED" | "GUEST_TAB_REOPENED",
  entityType: "GUEST_CONSUMPTION" | "GUEST_TAB",
  entityId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, actor_admin_id, action, entity_type, entity_id, metadata
     ) VALUES ('ADMIN', $1, $2, $3, $4, $5::jsonb)`,
    [adminId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

function addParameters(command: AddConsumptionCommand): unknown[] {
  const common = [
    command.eventId,
    command.reservationId,
    command.slot,
    command.source,
    command.quantity,
    command.adminId,
  ];
  return command.source === "CUSTOM"
    ? [...common, command.customName, command.customPriceCents]
    : [...common, command.itemId];
}

export class PostgresEconomyRepository implements EconomyRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  loadEventEconomy(eventId: string): Promise<EventEconomy> {
    return inTransaction(this.pool, readSettings, async (client) => {
      const guestRows = await client.query<GuestRow>(
        `WITH tabs AS (
           SELECT r.id AS reservation_id, r.reservation_number, r.stage, 1 AS slot,
                  r.full_name, r.instagram_handle AS instagram
             FROM reservations r
             JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
            WHERE r.event_id = $1 AND r.status = 'CONFIRMED' AND r.stage IN ('ON_LIST', 'PAID')
           UNION ALL
           SELECT r.id, r.reservation_number, r.stage, 2,
                  COALESCE(r.guest2_full_name, 'Acompañante'), r.guest2_instagram_handle
             FROM reservations r
             JOIN events e ON e.id = r.event_id AND e.deleted_at IS NULL
            WHERE r.event_id = $1 AND r.status = 'CONFIRMED' AND r.stage IN ('ON_LIST', 'PAID')
              AND r.party_size = 2
         ), totals AS (
           SELECT t.*,
                  COALESCE((
                    SELECT SUM(c.unit_price_cents::bigint * c.quantity)
                      FROM guest_consumptions c
                     WHERE c.reservation_id = t.reservation_id
                       AND c.guest_slot = t.slot
                       AND c.voided_at IS NULL
                  ), 0)::bigint AS total_cents,
                  g.settled_at
             FROM tabs t
             LEFT JOIN guest_tabs g
               ON g.reservation_id = t.reservation_id AND g.guest_slot = t.slot
         )
         SELECT totals.*, SUM(total_cents) OVER ()::bigint AS event_total_cents
           FROM totals
          ORDER BY reservation_number, slot`,
        [eventId],
      );
      const lineRows = await client.query<LineRow>(
        `SELECT id, reservation_id, guest_slot, source, item_name, unit_price_cents,
                quantity, created_at, voided_at
           FROM guest_consumptions
          WHERE event_id = $1
          ORDER BY created_at, id`,
        [eventId],
      );

      const linesByTab = new Map<string, ConsumptionLine[]>();
      for (const row of lineRows.rows) {
        const key = lineKey(row.reservation_id, row.guest_slot);
        const lines = linesByTab.get(key) ?? [];
        lines.push(lineFromRow(row));
        linesByTab.set(key, lines);
      }

      const guests: EconomyGuest[] = guestRows.rows.map((row) => ({
        reservationId: row.reservation_id,
        reservationNumber: row.reservation_number,
        slot: row.slot,
        fullName: row.full_name,
        instagram: row.instagram,
        stage: row.stage,
        totalCents: Number(row.total_cents),
        settled: row.settled_at !== null,
        settledAt: row.settled_at,
        lines: linesByTab.get(lineKey(row.reservation_id, row.slot)) ?? [],
      }));
      const firstRow = guestRows.rows[0];
      const eventTotalCents = firstRow ? Number(firstRow.event_total_cents) : 0;
      return { eventTotalCents, guests };
    });
  }

  addConsumption(
    command: AddConsumptionCommand,
  ): Promise<{ ok: true; line: ConsumptionLine } | { ok: false; code: AddConsumptionFailureCode }> {
    return inTransaction(this.pool, writeSettings, async (client) => {
      const inserted = await client.query<LineRow>(
        `WITH guest AS (
           SELECT r.id, r.event_id ${eligibleGuestSource}
         ), item AS (
           ${itemSources[command.source]}
         )
         INSERT INTO guest_consumptions (
           event_id, reservation_id, guest_slot, source, drink_id, extra_id,
           item_name, unit_price_cents, quantity, created_by
         )
         SELECT guest.event_id, guest.id, $3::smallint, $4, item.drink_id, item.extra_id,
                item.name, item.price_cents, $5::integer, $6::uuid
           FROM guest CROSS JOIN item
         RETURNING id, reservation_id, guest_slot, source, item_name, unit_price_cents,
                   quantity, created_at, voided_at`,
        addParameters(command),
      );
      const row = inserted.rows[0];
      if (!row) {
        const guestFound = await guestExists(client, command);
        return { ok: false as const, code: guestFound ? "ITEM_NOT_FOUND" : "GUEST_NOT_FOUND" };
      }

      await insertAudit(client, command.adminId, "CONSUMPTION_ADDED", "GUEST_CONSUMPTION", row.id, {
        eventId: command.eventId,
        reservationId: command.reservationId,
        slot: command.slot,
        source: row.source,
        itemName: row.item_name,
        quantity: row.quantity,
        unitPriceCents: row.unit_price_cents,
      });
      return { ok: true as const, line: lineFromRow(row) };
    });
  }

  voidConsumption(command: VoidConsumptionCommand): Promise<VoidConsumptionResult> {
    return inTransaction(this.pool, writeSettings, async (client) => {
      const voided = await client.query<LineRow>(
        `UPDATE guest_consumptions
            SET voided_at = now(), voided_by = $3
          WHERE id = $1 AND event_id = $2 AND voided_at IS NULL
          RETURNING id, reservation_id, guest_slot, source, item_name, unit_price_cents,
                    quantity, created_at, voided_at`,
        [command.consumptionId, command.eventId, command.adminId],
      );
      const row = voided.rows[0];
      if (!row) {
        const existing = await client.query(
          "SELECT 1 FROM guest_consumptions WHERE id = $1 AND event_id = $2",
          [command.consumptionId, command.eventId],
        );
        return {
          ok: false as const,
          code: existing.rowCount === 1 ? ("ALREADY_VOIDED" as const) : ("NOT_FOUND" as const),
        };
      }

      await insertAudit(
        client,
        command.adminId,
        "CONSUMPTION_VOIDED",
        "GUEST_CONSUMPTION",
        row.id,
        {
          eventId: command.eventId,
          reservationId: row.reservation_id,
          slot: row.guest_slot,
          itemName: row.item_name,
          quantity: row.quantity,
          unitPriceCents: row.unit_price_cents,
        },
      );
      return { ok: true as const };
    });
  }

  settleTab(command: TabCommand): Promise<TabResult> {
    return inTransaction(this.pool, writeSettings, async (client) => {
      const settled = await client.query(
        `INSERT INTO guest_tabs (reservation_id, guest_slot, settled_at, settled_by, updated_at)
         SELECT r.id, $3::smallint, now(), $4::uuid, now()
           ${eligibleGuestSource}
         ON CONFLICT (reservation_id, guest_slot) DO UPDATE
            SET settled_at = now(), settled_by = EXCLUDED.settled_by, updated_at = now()
          WHERE guest_tabs.settled_at IS NULL
         RETURNING reservation_id`,
        [command.eventId, command.reservationId, command.slot, command.adminId],
      );
      if (settled.rowCount === 0) return unchangedTabResult(client, command);

      await insertAudit(
        client,
        command.adminId,
        "GUEST_TAB_SETTLED",
        "GUEST_TAB",
        command.reservationId,
        { eventId: command.eventId, reservationId: command.reservationId, slot: command.slot },
      );
      return { ok: true as const, changed: true };
    });
  }

  reopenTab(command: TabCommand): Promise<TabResult> {
    return inTransaction(this.pool, writeSettings, async (client) => {
      const reopened = await client.query(
        `UPDATE guest_tabs
            SET settled_at = NULL, settled_by = NULL, updated_at = now()
          WHERE reservation_id = $2
            AND guest_slot = $3::smallint
            AND settled_at IS NOT NULL
            AND EXISTS (SELECT 1 ${eligibleGuestSource})
          RETURNING reservation_id`,
        [command.eventId, command.reservationId, command.slot],
      );
      if (reopened.rowCount === 0) return unchangedTabResult(client, command);

      await insertAudit(
        client,
        command.adminId,
        "GUEST_TAB_REOPENED",
        "GUEST_TAB",
        command.reservationId,
        { eventId: command.eventId, reservationId: command.reservationId, slot: command.slot },
      );
      return { ok: true as const, changed: true };
    });
  }

  async listPickerDrinks(): Promise<PickerItem[]> {
    const result = await this.pool.query<{ id: string; name: string; price_cents: number }>(
      `SELECT id, name, price_cents FROM drinks
        WHERE is_visible = true
        ORDER BY created_at, id`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      priceCents: row.price_cents,
    }));
  }
}

// A tab write that touched nothing is a no-op for a real guest and an error for an unknown one.
async function unchangedTabResult(client: PoolClient, reference: TabReference): Promise<TabResult> {
  const guestFound = await guestExists(client, reference);
  return guestFound ? { ok: true, changed: false } : { ok: false, code: "GUEST_NOT_FOUND" };
}

export const postgresEconomyRepository = new PostgresEconomyRepository();
