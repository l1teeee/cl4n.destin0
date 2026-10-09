import { randomBytes } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  AddEventImageResult,
  EventImageItem,
  EventImageRepository,
  StoredEventImage,
} from "@/application/events/event-image-repository";
import { MAX_EVENT_IMAGES, type EventImageContentType } from "@/contracts/event-image";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

interface EventImageRow extends QueryResultRow {
  id: string;
  content_type: EventImageContentType;
  byte_size: number;
  data?: Buffer;
  created_at: Date;
}

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

function imageItem(row: EventImageRow): EventImageItem {
  return {
    id: row.id,
    contentType: row.content_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

async function lockEventImages(client: PoolClient, eventId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('event_images:' || $1, 0))", [
    eventId,
  ]);
}

async function insertAudit(
  client: PoolClient,
  actorId: string,
  eventId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, actor_admin_id, action, entity_type, entity_id, metadata
     ) VALUES ('ADMIN', $1, 'EVENT_UPDATED', 'EVENT', $2, $3::jsonb)`,
    [actorId, eventId, JSON.stringify(metadata)],
  );
}

export class PostgresEventImageRepository implements EventImageRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  add(input: {
    eventId: string;
    contentType: EventImageContentType;
    data: Uint8Array;
    actorId: string;
  }): Promise<AddEventImageResult> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      await lockEventImages(client, input.eventId);
      const event = await client.query("SELECT 1 FROM events WHERE id = $1", [input.eventId]);
      if (event.rowCount === 0) return { ok: false, error: "EVENT_NOT_FOUND" };

      const count = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM event_images WHERE event_id = $1",
        [input.eventId],
      );
      if (count.rows[0]!.count >= MAX_EVENT_IMAGES) {
        return { ok: false, error: "MAX_IMAGES_REACHED" };
      }

      const inserted = await client.query<EventImageRow>(
        `INSERT INTO event_images (
           event_id, content_type, byte_size, data, public_token, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, content_type, byte_size, created_at`,
        [
          input.eventId,
          input.contentType,
          input.data.byteLength,
          Buffer.from(input.data),
          randomBytes(32).toString("base64url"),
          input.actorId,
        ],
      );
      const image = imageItem(inserted.rows[0]!);
      await insertAudit(client, input.actorId, input.eventId, {
        imageAdded: image.id,
        contentType: image.contentType,
        byteSize: image.byteSize,
      });
      return { ok: true, value: image };
    });
  }

  async list(eventId: string): Promise<EventImageItem[]> {
    const result = await this.pool.query<EventImageRow>(
      `SELECT id, content_type, byte_size, created_at
         FROM event_images
        WHERE event_id = $1
        ORDER BY created_at, id`,
      [eventId],
    );
    return result.rows.map(imageItem);
  }

  async get(eventId: string, imageId: string): Promise<StoredEventImage | null> {
    const result = await this.pool.query<EventImageRow>(
      `SELECT id, content_type, byte_size, data, created_at
         FROM event_images
        WHERE event_id = $1 AND id = $2`,
      [eventId, imageId],
    );
    const row = result.rows[0];
    return row ? { ...imageItem(row), data: row.data! } : null;
  }

  async getByPublicToken(publicToken: string): Promise<StoredEventImage | null> {
    const result = await this.pool.query<EventImageRow>(
      `SELECT id, content_type, byte_size, data, created_at
         FROM event_images
        WHERE public_token = $1`,
      [publicToken],
    );
    const row = result.rows[0];
    return row ? { ...imageItem(row), data: row.data! } : null;
  }

  remove(eventId: string, imageId: string, actorId: string): Promise<boolean> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      await lockEventImages(client, eventId);
      const deleted = await client.query<{ id: string }>(
        "DELETE FROM event_images WHERE event_id = $1 AND id = $2 RETURNING id",
        [eventId, imageId],
      );
      if (deleted.rowCount === 0) return false;
      await insertAudit(client, actorId, eventId, { imageRemoved: imageId });
      return true;
    });
  }
}

export const postgresEventImageRepository = new PostgresEventImageRepository();
