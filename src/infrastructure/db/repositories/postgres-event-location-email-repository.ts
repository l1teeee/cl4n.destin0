import type { Pool, QueryResultRow } from "pg";

import type {
  EventLocationEmailRepository,
  EventLocationEmailSummary,
  QueueEventLocationEmailsResult,
} from "@/application/events/location-email-repository";
import type { EventLocationStatus } from "@/domain/event/event-location";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

interface EventLocationRow extends QueryResultRow {
  location_status: EventLocationStatus;
  location_revision: number;
}

interface LocationEmailSummaryRow extends QueryResultRow {
  confirmed_reservations: number;
  sent: number;
  pending: number;
  failed: number;
  not_yet_queued: number;
  has_older_sent: boolean;
  last_sent_at: Date | null;
}

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

export class PostgresEventLocationEmailRepository implements EventLocationEmailRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  queue(eventId: string, actorAdminId: string): Promise<QueueEventLocationEmailsResult> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const eventResult = await client.query<EventLocationRow>(
        `SELECT location_status, location_revision
           FROM events
          WHERE id = $1`,
        [eventId],
      );
      const event = eventResult.rows[0];
      if (!event) return { ok: false, error: "EVENT_NOT_FOUND" };
      if (event.location_status !== "CONFIRMED") {
        return { ok: false, error: "LOCATION_NOT_CONFIRMED" };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO email_outbox (kind, reservation_id, location_revision, payload)
         SELECT 'EVENT_LOCATION', r.id, e.location_revision,
                jsonb_build_object(
                  'isUpdate', EXISTS (
                    SELECT 1
                      FROM email_outbox previous
                     WHERE previous.kind = 'EVENT_LOCATION'
                       AND previous.reservation_id = r.id
                       AND previous.status = 'SENT'
                       AND previous.location_revision < e.location_revision
                  )
                )
           FROM reservations r
           JOIN events e ON e.id = r.event_id
          WHERE r.event_id = $1
            AND r.status = 'CONFIRMED'
            AND e.location_status = 'CONFIRMED'
            AND e.location_revision = $2
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [eventId, event.location_revision],
      );
      const queued = inserted.rowCount ?? 0;

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         ) VALUES ('ADMIN', $1, 'EVENT_UPDATED', 'EVENT', $2, $3::jsonb)`,
        [
          actorAdminId,
          eventId,
          JSON.stringify({
            locationEmailsQueued: queued,
            locationRevision: event.location_revision,
          }),
        ],
      );

      return {
        ok: true,
        queued,
        locationRevision: event.location_revision,
      };
    });
  }

  async getSummary(eventId: string): Promise<EventLocationEmailSummary | null> {
    const result = await this.pool.query<LocationEmailSummaryRow>(
      `SELECT
         COUNT(r.id)::int AS confirmed_reservations,
         COUNT(o.id) FILTER (WHERE o.status = 'SENT')::int AS sent,
         COUNT(o.id) FILTER (WHERE o.status = 'PENDING')::int AS pending,
         COUNT(o.id) FILTER (WHERE o.status = 'FAILED')::int AS failed,
         (COUNT(r.id) - COUNT(o.id))::int AS not_yet_queued,
         EXISTS (
           SELECT 1
             FROM reservations previous_reservation
             JOIN email_outbox previous
               ON previous.reservation_id = previous_reservation.id
              AND previous.kind = 'EVENT_LOCATION'
            WHERE previous_reservation.event_id = e.id
              AND previous.status = 'SENT'
              AND previous.location_revision < e.location_revision
         ) AS has_older_sent,
         MAX(o.sent_at) FILTER (WHERE o.status = 'SENT') AS last_sent_at
       FROM events e
       LEFT JOIN reservations r
         ON r.event_id = e.id
        AND r.status = 'CONFIRMED'
       LEFT JOIN email_outbox o
         ON o.reservation_id = r.id
        AND o.kind = 'EVENT_LOCATION'
        AND o.location_revision = e.location_revision
      WHERE e.id = $1
      GROUP BY e.id`,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      confirmedReservations: row.confirmed_reservations,
      sent: row.sent,
      pending: row.pending,
      failed: row.failed,
      notYetQueued: row.not_yet_queued,
      hasOlderSent: row.has_older_sent,
      lastSentAt: row.last_sent_at,
    };
  }
}

export const postgresEventLocationEmailRepository = new PostgresEventLocationEmailRepository();
