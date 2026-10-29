import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  DrinkDetails,
  DrinkImageChange,
  DrinkImageFile,
  DrinkItem,
  DrinkRepository,
  PublicDrink,
  StoredDrinkImage,
} from "@/application/drinks/drink-repository";
import type { ImageContentType } from "@/contracts/image-upload";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

interface DrinkRow extends QueryResultRow {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  is_visible: boolean;
  image_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DrinkImageRow extends QueryResultRow {
  id: string;
  content_type: ImageContentType;
  data: Buffer;
}

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

function drinkItem(row: DrinkRow): DrinkItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.price_cents,
    isVisible: row.is_visible,
    imageId: row.image_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicDrink(row: DrinkRow): PublicDrink {
  const item = drinkItem(row);
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    priceCents: item.priceCents,
    imageId: item.imageId,
  };
}

async function insertImage(
  client: PoolClient,
  drinkId: string,
  image: DrinkImageFile,
  actorId: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO drink_images (drink_id, content_type, byte_size, data, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [drinkId, image.contentType, image.data.byteLength, Buffer.from(image.data), actorId],
  );
  return result.rows[0]!.id;
}

async function insertAudit(
  client: PoolClient,
  actorId: string,
  action: "DRINK_CREATED" | "DRINK_UPDATED" | "DRINK_DELETED",
  drinkId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, actor_admin_id, action, entity_type, entity_id, metadata
     ) VALUES ('ADMIN', $1, $2, 'DRINK', $3, $4::jsonb)`,
    [actorId, action, drinkId, JSON.stringify(metadata)],
  );
}

export class PostgresDrinkRepository implements DrinkRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  create(
    input: DrinkDetails & { image: DrinkImageFile | null; actorId: string },
  ): Promise<DrinkItem> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const inserted = await client.query<DrinkRow>(
        `INSERT INTO drinks (name, description, price_cents, is_visible, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, description, price_cents, is_visible, created_at, updated_at`,
        [input.name, input.description, input.priceCents, input.isVisible, input.actorId],
      );
      const row = inserted.rows[0]!;
      row.image_id = input.image
        ? await insertImage(client, row.id, input.image, input.actorId)
        : null;
      await insertAudit(client, input.actorId, "DRINK_CREATED", row.id, {
        name: input.name,
        priceCents: input.priceCents,
        isVisible: input.isVisible,
        hasImage: input.image !== null,
      });
      return drinkItem(row);
    });
  }

  update(
    input: DrinkDetails & { id: string; image: DrinkImageChange; actorId: string },
  ): Promise<DrinkItem | null> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM drinks WHERE id = $1 FOR UPDATE",
        [input.id],
      );
      if (existing.rowCount === 0) return null;

      const updated = await client.query<DrinkRow>(
        `UPDATE drinks
            SET name = $2, description = $3, price_cents = $4, is_visible = $5, updated_at = now()
          WHERE id = $1
          RETURNING id, name, description, price_cents, is_visible, created_at, updated_at`,
        [input.id, input.name, input.description, input.priceCents, input.isVisible],
      );

      if (input.image.kind !== "keep") {
        await client.query("DELETE FROM drink_images WHERE drink_id = $1", [input.id]);
      }
      const row = updated.rows[0]!;
      if (input.image.kind === "replace") {
        row.image_id = await insertImage(client, input.id, input.image.image, input.actorId);
      } else {
        const image = await client.query<{ id: string }>(
          "SELECT id FROM drink_images WHERE drink_id = $1",
          [input.id],
        );
        row.image_id = image.rows[0]?.id ?? null;
      }

      await insertAudit(client, input.actorId, "DRINK_UPDATED", input.id, {
        name: input.name,
        priceCents: input.priceCents,
        isVisible: input.isVisible,
        image:
          input.image.kind === "keep"
            ? "kept"
            : input.image.kind === "replace"
              ? "replaced"
              : "removed",
      });
      return drinkItem(row);
    });
  }

  delete(id: string, actorId: string): Promise<boolean> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const deleted = await client.query<{ name: string; price_cents: number }>(
        "DELETE FROM drinks WHERE id = $1 RETURNING name, price_cents",
        [id],
      );
      const row = deleted.rows[0];
      if (!row) return false;
      await insertAudit(client, actorId, "DRINK_DELETED", id, {
        name: row.name,
        priceCents: row.price_cents,
      });
      return true;
    });
  }

  async get(id: string): Promise<DrinkItem | null> {
    const result = await this.pool.query<DrinkRow>(
      `SELECT d.id, d.name, d.description, d.price_cents, d.is_visible,
              di.id AS image_id, d.created_at, d.updated_at
         FROM drinks d
         LEFT JOIN drink_images di ON di.drink_id = d.id
        WHERE d.id = $1`,
      [id],
    );
    return result.rows[0] ? drinkItem(result.rows[0]) : null;
  }

  async listForAdmin(): Promise<DrinkItem[]> {
    const result = await this.pool.query<DrinkRow>(
      `SELECT d.id, d.name, d.description, d.price_cents, d.is_visible,
              di.id AS image_id, d.created_at, d.updated_at
         FROM drinks d
         LEFT JOIN drink_images di ON di.drink_id = d.id
        ORDER BY d.created_at, d.id`,
    );
    return result.rows.map(drinkItem);
  }

  async listVisible(): Promise<PublicDrink[]> {
    const result = await this.pool.query<DrinkRow>(
      `SELECT d.id, d.name, d.description, d.price_cents, d.is_visible,
              di.id AS image_id, d.created_at, d.updated_at
         FROM drinks d
         LEFT JOIN drink_images di ON di.drink_id = d.id
        WHERE d.is_visible = true
        ORDER BY d.created_at, d.id`,
    );
    return result.rows.map(publicDrink);
  }

  async getImage(imageId: string): Promise<StoredDrinkImage | null> {
    const result = await this.pool.query<DrinkImageRow>(
      "SELECT id, content_type, data FROM drink_images WHERE id = $1",
      [imageId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, contentType: row.content_type, data: row.data } : null;
  }
}

export const postgresDrinkRepository = new PostgresDrinkRepository();
