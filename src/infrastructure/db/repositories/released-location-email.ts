import type { PoolClient } from "pg";

/**
 * The caller must already hold the event row lock in its confirmation transaction.
 */
export async function queueReleasedLocationEmail(
  client: PoolClient,
  eventId: string,
  reservationId: string,
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO email_outbox (
       kind, reservation_id, location_revision, payload, created_at
     )
     SELECT 'EVENT_LOCATION', $2, e.location_revision,
            jsonb_build_object('isUpdate', false), clock_timestamp()
       FROM events e
      WHERE e.id = $1
        AND e.location_status = 'CONFIRMED'
        AND e.location_released_revision = e.location_revision
     ON CONFLICT (reservation_id, location_revision) WHERE kind = 'EVENT_LOCATION'
     DO NOTHING`,
    [eventId, reservationId],
  );
  return result.rowCount === 1;
}
