import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { EventClueDelivery } from "@/application/events/event-clue-repository";
import { clueImageUrl } from "@/domain/messaging/message-attachment-urls";
import { env } from "@/infrastructure/config/env";

interface ClueDeliveryRow extends QueryResultRow {
  clue_id: string;
  paid: number;
  received: number;
  pending: number;
  failed: number;
}

/**
 * Runs inside the clue insert transaction. It deliberately takes no lock on the event row (ADR-007
 * decision 8): a guest who turns PAID at the same moment may miss this clue, which ADR-007 accepts.
 */
export async function enqueueClueMessages(
  client: PoolClient,
  input: {
    eventId: string;
    eventSlug: string;
    clueId: string;
    body: string;
    imageIds: readonly string[];
    actorId: string;
  },
): Promise<string[]> {
  const imageUrls = input.imageIds.map((imageId) =>
    clueImageUrl(env.APP_BASE_URL, input.eventSlug, imageId),
  );

  const result = await client.query<{ id: string }>(
    // FOR SHARE on the reservations makes the insert wait for a concurrent unlink and then read the
    // new contact, so no QUEUED row is left on a contact that was just unlinked.
    `WITH paid_guests AS (
       SELECT r.id, r.contact_id, r.event_id
         FROM reservations r
        WHERE r.event_id = $1
          AND r.status = 'CONFIRMED'
          AND r.stage = 'PAID'
          FOR SHARE OF r
     )
     INSERT INTO messages (
       contact_id, reservation_id, event_id, direction, kind, source, status,
       body, attachment_urls, clue_id, created_by
     )
     SELECT guest.contact_id, guest.id, guest.event_id, 'OUTBOUND', 'CLUE', 'ADMIN',
            CASE WHEN guest.contact_id IS NULL THEN 'WAITING_CONTACT' ELSE 'QUEUED' END,
            $3::text, $4::text[], $2::uuid, $5::uuid
       FROM paid_guests guest
     ON CONFLICT (reservation_id, clue_id) WHERE kind = 'CLUE'
     DO NOTHING
     RETURNING id`,
    [
      input.eventId,
      input.clueId,
      input.body,
      imageUrls.length > 0 ? imageUrls : null,
      input.actorId,
    ],
  );
  return result.rows.map((row) => row.id);
}

export async function queryClueDelivery(
  pool: Pool,
  eventId: string,
): Promise<Record<string, EventClueDelivery>> {
  const result = await pool.query<ClueDeliveryRow>(
    `WITH paid_guests AS (
       SELECT id
         FROM reservations
        WHERE event_id = $1
          AND status = 'CONFIRMED'
          AND stage = 'PAID'
     )
     SELECT c.id AS clue_id,
            (SELECT count(*) FROM paid_guests)::int AS paid,
            count(m.id) FILTER (
              WHERE m.status IN ('SENT', 'READ', 'SENT_MANUALLY')
            )::int AS received,
            count(m.id) FILTER (
              WHERE m.status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED')
            )::int AS pending,
            count(m.id) FILTER (WHERE m.status = 'FAILED')::int AS failed
       FROM event_clues c
       LEFT JOIN messages m
         ON m.clue_id = c.id
        AND m.kind = 'CLUE'
        AND m.reservation_id IN (SELECT id FROM paid_guests)
      WHERE c.event_id = $1
      GROUP BY c.id`,
    [eventId],
  );

  const deliveryByClue: Record<string, EventClueDelivery> = {};
  for (const row of result.rows) {
    deliveryByClue[row.clue_id] = {
      paid: row.paid,
      received: row.received,
      pending: row.pending,
      failed: row.failed,
    };
  }
  return deliveryByClue;
}
