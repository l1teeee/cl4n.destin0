import type { Pool, QueryResultRow } from "pg";

import type {
  EmailOutboxKind,
  EmailOutboxRepository,
  EmailOutboxRow,
  EmailOutboxStatus,
  RecentEmailOutboxItem,
} from "@/application/notifications/email-outbox";

import { pool as applicationPool } from "../../db/client";

const LEASE_INTERVAL = "2 minutes";

interface OutboxRecord extends QueryResultRow {
  id: string;
  kind: EmailOutboxKind;
  reservation_id: string | null;
  waitlist_entry_id: string | null;
  admin_user_id: string | null;
  payload: Record<string, unknown>;
  status: EmailOutboxStatus;
  attempts: number;
  next_attempt_at: Date;
  locked_until: Date | null;
  last_error: string | null;
  sent_at: Date | null;
  created_at: Date;
}

interface RecentRecord extends QueryResultRow {
  id: string;
  kind: EmailOutboxKind;
  status: EmailOutboxStatus;
  attempts: number;
  last_error: string | null;
  sent_at: Date | null;
  created_at: Date;
  next_attempt_at: Date;
  recipient_email: string | null;
}

function toRow(record: OutboxRecord): EmailOutboxRow {
  return {
    id: record.id,
    kind: record.kind,
    reservationId: record.reservation_id,
    waitlistEntryId: record.waitlist_entry_id,
    adminUserId: record.admin_user_id,
    payload: record.payload,
    status: record.status,
    attempts: record.attempts,
    nextAttemptAt: record.next_attempt_at,
    lockedUntil: record.locked_until,
    lastError: record.last_error,
    sentAt: record.sent_at,
    createdAt: record.created_at,
  };
}

export class PostgresEmailOutboxRepository implements EmailOutboxRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async claimDue(limit: number): Promise<EmailOutboxRow[]> {
    // clock_timestamp keeps the lease and the due check on the database clock, never the app clock.
    const result = await this.pool.query<OutboxRecord>(
      `UPDATE email_outbox
          SET locked_until = date_trunc('milliseconds', clock_timestamp()) + interval '${LEASE_INTERVAL}',
              attempts = attempts + 1
        WHERE id IN (
          SELECT id
            FROM email_outbox
           WHERE status = 'PENDING'
             AND next_attempt_at <= clock_timestamp()
             AND (locked_until IS NULL OR locked_until < clock_timestamp())
           ORDER BY created_at
           LIMIT $1
             FOR UPDATE SKIP LOCKED
        )
    RETURNING id, kind, reservation_id, waitlist_entry_id, admin_user_id, payload, status,
              attempts, next_attempt_at, locked_until, last_error, sent_at, created_at`,
      [limit],
    );
    return result.rows.map(toRow).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async markSent(id: string, lease: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE email_outbox
          SET status = 'SENT',
              sent_at = clock_timestamp(),
              locked_until = NULL,
              last_error = NULL
        WHERE id = $1
          AND status = 'PENDING'
          AND locked_until = $2`,
      [id, lease],
    );
    return result.rowCount === 1;
  }

  async scheduleRetry(
    id: string,
    lease: Date,
    delaySeconds: number,
    errorCode: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE email_outbox
          SET next_attempt_at = clock_timestamp() + make_interval(secs => $3),
              locked_until = NULL,
              last_error = $4
        WHERE id = $1
          AND status = 'PENDING'
          AND locked_until = $2`,
      [id, lease, delaySeconds, errorCode],
    );
    return result.rowCount === 1;
  }

  async markFailed(id: string, lease: Date, errorCode: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE email_outbox
          SET status = 'FAILED',
              locked_until = NULL,
              last_error = $3
        WHERE id = $1
          AND status = 'PENDING'
          AND locked_until = $2`,
      [id, lease, errorCode],
    );
    return result.rowCount === 1;
  }

  async listRecent(input: {
    limit: number;
    status?: EmailOutboxStatus;
    kind?: EmailOutboxKind;
  }): Promise<RecentEmailOutboxItem[]> {
    const result = await this.pool.query<RecentRecord>(
      `SELECT o.id, o.kind, o.status, o.attempts, o.last_error, o.sent_at, o.created_at,
              o.next_attempt_at,
              COALESCE(r.email, w.email, a.email) AS recipient_email
         FROM email_outbox o
         LEFT JOIN reservations r ON r.id = o.reservation_id
         LEFT JOIN waitlist_entries w ON w.id = o.waitlist_entry_id
         LEFT JOIN admin_users a ON a.id = o.admin_user_id
        WHERE ($2::text IS NULL OR o.status = $2)
          AND ($3::text IS NULL OR o.kind = $3)
        ORDER BY o.created_at DESC, o.id
        LIMIT $1`,
      [input.limit, input.status ?? null, input.kind ?? null],
    );
    return result.rows.map((record) => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      attempts: record.attempts,
      lastError: record.last_error,
      sentAt: record.sent_at,
      createdAt: record.created_at,
      nextAttemptAt: record.next_attempt_at,
      recipientEmail: record.recipient_email ?? "",
    }));
  }

  async countByStatusSince(days: number): Promise<Record<EmailOutboxStatus, number>> {
    const result = await this.pool.query<{ status: EmailOutboxStatus; total: number }>(
      `SELECT status, COUNT(*)::int AS total
         FROM email_outbox
        WHERE created_at >= clock_timestamp() - make_interval(days => $1)
        GROUP BY status`,
      [days],
    );
    const totals: Record<EmailOutboxStatus, number> = { PENDING: 0, SENT: 0, FAILED: 0 };
    for (const row of result.rows) {
      totals[row.status] = row.total;
    }
    return totals;
  }

  async retry(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE email_outbox
          SET status = 'PENDING',
              attempts = 0,
              next_attempt_at = clock_timestamp(),
              locked_until = NULL
        WHERE id = $1
          AND status = 'FAILED'`,
      [id],
    );
    return result.rowCount === 1;
  }

  async deleteSentOlderThan(days: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM email_outbox
        WHERE status = 'SENT'
          AND sent_at < clock_timestamp() - make_interval(days => $1)`,
      [days],
    );
    return result.rowCount ?? 0;
  }
}

export const postgresEmailOutboxRepository = new PostgresEmailOutboxRepository();
