import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  AddEventClueResult,
  EventClue,
  EventClueRepository,
} from "@/application/events/event-clue-repository";
import type { ImageContentType } from "@/contracts/image-upload";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

interface EventClueRow extends QueryResultRow {
  id: string;
  body: string;
  created_at: Date;
  image_ids?: string[];
}

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

function eventClue(row: EventClueRow): EventClue {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    images: (row.image_ids ?? []).map((id) => ({ id })),
  };
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

export class PostgresEventClueRepository implements EventClueRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  add(input: {
    eventId: string;
    body: string;
    actorId: string;
    images?: Array<{ contentType: ImageContentType; data: Uint8Array }>;
  }): Promise<AddEventClueResult> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const event = await client.query(
        "SELECT 1 FROM events WHERE id = $1 AND deleted_at IS NULL",
        [input.eventId],
      );
      if (event.rowCount === 0) return { ok: false, error: "EVENT_NOT_FOUND" };

      const inserted = await client.query<EventClueRow>(
        `INSERT INTO event_clues (event_id, body, created_by)
         VALUES ($1, $2, $3)
         RETURNING id, body, created_at`,
        [input.eventId, input.body, input.actorId],
      );
      const clue = eventClue(inserted.rows[0]!);
      const imageIds: string[] = [];
      for (const [position, image] of (input.images ?? []).entries()) {
        const insertedImage = await client.query<{ id: string }>(
          `INSERT INTO event_clue_images (clue_id, position, content_type, byte_size, data)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [clue.id, position, image.contentType, image.data.byteLength, Buffer.from(image.data)],
        );
        imageIds.push(insertedImage.rows[0]!.id);
      }
      clue.images = imageIds.map((id) => ({ id }));
      await insertAudit(client, input.actorId, input.eventId, { clueAdded: clue.id });
      return { ok: true, value: clue };
    });
  }

  async remove(input: { eventId: string; clueId: string; actorId: string }): Promise<boolean> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const deleted = await client.query<{ id: string }>(
        "DELETE FROM event_clues WHERE event_id = $1 AND id = $2 RETURNING id",
        [input.eventId, input.clueId],
      );
      if (deleted.rowCount === 0) return false;
      await insertAudit(client, input.actorId, input.eventId, { clueRemoved: input.clueId });
      return true;
    });
  }

  async listForEvent(eventId: string): Promise<EventClue[]> {
    const result = await this.pool.query<EventClueRow>(
      `SELECT c.id, c.body, c.created_at,
              COALESCE(array_agg(i.id ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '{}') AS image_ids
         FROM event_clues c
         LEFT JOIN event_clue_images i ON i.clue_id = c.id
        WHERE c.event_id = $1
        GROUP BY c.id
        ORDER BY c.created_at, c.id`,
      [eventId],
    );
    return result.rows.map(eventClue);
  }

  async listForSlug(slug: string): Promise<EventClue[]> {
    const result = await this.pool.query<EventClueRow>(
      `SELECT c.id, c.body, c.created_at,
              COALESCE(array_agg(i.id ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '{}') AS image_ids
         FROM event_clues c
         JOIN events e ON e.id = c.event_id
         LEFT JOIN event_clue_images i ON i.clue_id = c.id
        WHERE e.slug = $1
          AND e.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.created_at, c.id`,
      [slug],
    );
    return result.rows.map(eventClue);
  }

  async getImageForSlug(slug: string, imageId: string) {
    const result = await this.pool.query<{
      content_type: ImageContentType;
      data: Buffer;
    }>(
      `SELECT i.content_type, i.data
         FROM event_clue_images i
         JOIN event_clues c ON c.id = i.clue_id
         JOIN events e ON e.id = c.event_id
        WHERE e.slug = $1
          AND e.deleted_at IS NULL
          AND i.id = $2
          AND (e.status IN ('CLOSED', 'COMPLETED')
               OR (e.status = 'SCHEDULED' AND e.closes_at <= clock_timestamp()))`,
      [slug, imageId],
    );
    const row = result.rows[0];
    return row ? { contentType: row.content_type, data: row.data } : null;
  }
}

export const postgresEventClueRepository = new PostgresEventClueRepository();
