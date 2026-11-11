import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { EventClueDelivery } from "@/application/events/event-clue-repository";
import type { RecipientGroup } from "@/application/messaging/recipient-groups";
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
 * SQL expression for the contact of a guest slot: the titular contact for slot 1, otherwise the
 * contact of the request_guests row of that slot. `slot` and `reservation` are SQL aliases.
 */
export function slotContactSql(slot: string, reservation: string): string {
  return `CASE WHEN ${slot} = 1 THEN ${reservation}.contact_id ELSE (
    SELECT rg.contact_id FROM request_guests rg
     WHERE rg.reservation_id = ${reservation}.id AND rg.slot = ${slot}
  ) END`;
}

/**
 * Runs inside the clue send transaction. It deliberately takes no lock on the event row (ADR-007
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
    person?: { reservationId: string; slot: number };
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
          ${input.person ? "AND r.id = $6::uuid" : ""}
          FOR SHARE OF r
     )
     INSERT INTO messages (
       contact_id, reservation_id, guest_slot, event_id, direction, kind, source, status,
       body, attachment_urls, clue_id, created_by
     )
     SELECT person.contact_id, guest.id, person.slot, guest.event_id, 'OUTBOUND', 'CLUE', 'ADMIN',
            CASE WHEN person.contact_id IS NULL THEN 'WAITING_CONTACT' ELSE 'QUEUED' END,
            $3::text, $4::text[], $2::uuid, $5::uuid
       FROM paid_guests guest
       CROSS JOIN LATERAL (
         SELECT 1 AS slot, guest.contact_id
         UNION ALL
         SELECT rg.slot, rg.contact_id FROM request_guests rg WHERE rg.reservation_id = guest.id
       ) person
      WHERE true
        ${input.person ? "AND person.slot = $7::smallint" : ""}
     ON CONFLICT (reservation_id, guest_slot, clue_id) WHERE kind = 'CLUE'
     DO NOTHING
     RETURNING id`,
    [
      input.eventId,
      input.clueId,
      input.body,
      imageUrls.length > 0 ? imageUrls : null,
      input.actorId,
      ...(input.person ? [input.person.reservationId, input.person.slot] : []),
    ],
  );
  return result.rows.map((row) => row.id);
}

export async function queryClueRecipients(pool: Pool, eventId: string): Promise<RecipientGroup[]> {
  const result = await pool.query<{
    reservation_id: string;
    reservation_number: number;
    people: RecipientGroup["people"];
  }>(
    `WITH people AS (
       SELECT r.id, r.reservation_number, person.slot, person.name,
              COALESCE(contact.username, person.handle) AS instagram,
              person.contact_id IS NOT NULL AS linked,
            COALESCE(jsonb_object_agg(c.id::text,
              CASE
                WHEN m.status IN ('SENT', 'READ', 'SENT_MANUALLY') THEN 'SENT'
                WHEN m.status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED') THEN 'PENDING'
                WHEN m.status = 'FAILED' THEN 'FAILED'
                ELSE 'NOT_SENT'
              END
            ) FILTER (WHERE c.id IS NOT NULL), '{}'::jsonb) AS status_by_item
       FROM reservations r
       CROSS JOIN LATERAL (
         SELECT 1 AS slot, r.full_name AS name, r.instagram_handle AS handle, r.contact_id
         UNION ALL
         SELECT rg.slot, rg.full_name, rg.instagram_handle, rg.contact_id
           FROM request_guests rg WHERE rg.reservation_id = r.id
       ) person
       LEFT JOIN messaging_contacts contact ON contact.id = person.contact_id
       LEFT JOIN event_clues c ON c.event_id = r.event_id
       LEFT JOIN messages m ON m.reservation_id = r.id AND m.guest_slot = person.slot
         AND m.clue_id = c.id AND m.kind = 'CLUE'
      WHERE r.event_id = $1 AND r.status = 'CONFIRMED' AND r.stage = 'PAID'
        AND person.name IS NOT NULL
      GROUP BY r.id, person.slot, person.name, person.handle, person.contact_id, contact.username
     )
     SELECT id AS reservation_id, reservation_number,
            jsonb_agg(jsonb_build_object(
              'slot', slot, 'name', name, 'instagram', instagram,
              'linked', linked, 'statusByItem', status_by_item
            ) ORDER BY slot) AS people
       FROM people
      GROUP BY id, reservation_number
      ORDER BY reservation_number`,
    [eventId],
  );
  return result.rows.map((row) => ({
    reservationId: row.reservation_id,
    reservationNumber: row.reservation_number,
    people: row.people,
  }));
}

export async function queryClueDelivery(
  pool: Pool,
  eventId: string,
): Promise<Record<string, EventClueDelivery>> {
  const result = await pool.query<ClueDeliveryRow>(
    `WITH paid_guests AS (
       SELECT r.id, person.slot
         FROM reservations r
         CROSS JOIN LATERAL (
           SELECT 1 AS slot
           UNION ALL
           SELECT rg.slot FROM request_guests rg WHERE rg.reservation_id = r.id
         ) person
        WHERE r.event_id = $1
          AND r.status = 'CONFIRMED'
          AND r.stage = 'PAID'
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
        AND (m.reservation_id, m.guest_slot) IN (SELECT id, slot FROM paid_guests)
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
