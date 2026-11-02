import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  ExtraDetails,
  ExtraItem,
  ExtraRepository,
  PickerItem,
} from "@/application/extras/extra-repository";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

interface ExtraRow extends QueryResultRow {
  id: string;
  name: string;
  price_cents: number;
  is_active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

const extraColumns = "id, name, price_cents, is_active, sort_order, created_at, updated_at";

function extraItem(row: ExtraRow): ExtraItem {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertAudit(
  client: PoolClient,
  actorId: string,
  action: "EXTRA_CREATED" | "EXTRA_UPDATED" | "EXTRA_DELETED",
  extraId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, actor_admin_id, action, entity_type, entity_id, metadata
     ) VALUES ('ADMIN', $1, $2, 'EXTRA', $3, $4::jsonb)`,
    [actorId, action, extraId, JSON.stringify(metadata)],
  );
}

export class PostgresExtraRepository implements ExtraRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  create(input: ExtraDetails & { actorId: string }): Promise<ExtraItem> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const inserted = await client.query<ExtraRow>(
        `INSERT INTO extras (name, price_cents, is_active, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING ${extraColumns}`,
        [input.name, input.priceCents, input.isActive, input.sortOrder],
      );
      const row = inserted.rows[0]!;
      await insertAudit(client, input.actorId, "EXTRA_CREATED", row.id, {
        name: input.name,
        priceCents: input.priceCents,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      });
      return extraItem(row);
    });
  }

  update(input: ExtraDetails & { id: string; actorId: string }): Promise<ExtraItem | null> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const updated = await client.query<ExtraRow>(
        `UPDATE extras
            SET name = $2, price_cents = $3, is_active = $4, sort_order = $5, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING ${extraColumns}`,
        [input.id, input.name, input.priceCents, input.isActive, input.sortOrder],
      );
      const row = updated.rows[0];
      if (!row) return null;
      await insertAudit(client, input.actorId, "EXTRA_UPDATED", input.id, {
        name: input.name,
        priceCents: input.priceCents,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      });
      return extraItem(row);
    });
  }

  // Soft delete: old consumption lines keep their snapshot and the audit trail keeps the id.
  delete(id: string, actorId: string): Promise<boolean> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const deleted = await client.query<{ name: string; price_cents: number }>(
        `UPDATE extras
            SET deleted_at = now(), is_active = false, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING name, price_cents`,
        [id],
      );
      const row = deleted.rows[0];
      if (!row) return false;
      await insertAudit(client, actorId, "EXTRA_DELETED", id, {
        name: row.name,
        priceCents: row.price_cents,
      });
      return true;
    });
  }

  async get(id: string): Promise<ExtraItem | null> {
    const result = await this.pool.query<ExtraRow>(
      `SELECT ${extraColumns} FROM extras WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? extraItem(result.rows[0]) : null;
  }

  async listForAdmin(): Promise<ExtraItem[]> {
    const result = await this.pool.query<ExtraRow>(
      `SELECT ${extraColumns} FROM extras
        WHERE deleted_at IS NULL
        ORDER BY sort_order, created_at, id`,
    );
    return result.rows.map(extraItem);
  }

  async listActive(): Promise<PickerItem[]> {
    const result = await this.pool.query<ExtraRow>(
      `SELECT ${extraColumns} FROM extras
        WHERE deleted_at IS NULL AND is_active = true
        ORDER BY sort_order, created_at, id`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      priceCents: row.price_cents,
    }));
  }
}

export const postgresExtraRepository = new PostgresExtraRepository();
