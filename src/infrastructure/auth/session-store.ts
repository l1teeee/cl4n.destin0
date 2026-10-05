import { createHash, randomBytes } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import type {
  AdminAuthRepository,
  CreatedAdminSession,
} from "@/application/auth/admin-auth-repository";
import type { AdminSession, AdminUser } from "@/application/auth/types";

import { pool as applicationPool } from "../db/client";

const ABSOLUTE_LIFETIME_HOURS = 12;
const IDLE_TIMEOUT_HOURS = 2;
const LAST_SEEN_REFRESH_MINUTES = 5;

interface AdminUserRow extends QueryResultRow {
  id: string;
  email_normalized: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
}

interface SessionRow extends QueryResultRow {
  id: string;
  admin_user_id: string;
  email_normalized: string;
  display_name: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  db_now: Date;
  refresh_due: boolean;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export class PostgresAdminAuthRepository implements AdminAuthRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async findByEmail(emailNormalized: string): Promise<AdminUser | null> {
    const result = await this.pool.query<AdminUserRow>(
      `SELECT id, email_normalized, display_name, password_hash, is_active
         FROM admin_users
        WHERE email_normalized = $1`,
      [emailNormalized],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          emailNormalized: row.email_normalized,
          displayName: row.display_name,
          passwordHash: row.password_hash,
          isActive: row.is_active,
        }
      : null;
  }

  async createSession(adminId: string): Promise<CreatedAdminSession> {
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const admin = await client.query<AdminUserRow>(
        `SELECT id, email_normalized, display_name, password_hash, is_active
           FROM admin_users
          WHERE id = $1 AND is_active = true
          FOR UPDATE`,
        [adminId],
      );
      const row = admin.rows[0];
      if (!row) {
        throw new Error("No se encontró un administrador activo");
      }

      await client.query(
        "DELETE FROM admin_sessions WHERE admin_user_id = $1 AND expires_at <= clock_timestamp()",
        [adminId],
      );
      const inserted = await client.query<{ expires_at: Date }>(
        `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
         INSERT INTO admin_sessions (
           token_hash,
           admin_user_id,
           created_at,
           last_seen_at,
           expires_at
         )
         SELECT
           $1,
           $2,
           db_now,
           db_now,
           db_now + make_interval(hours => $3)
         FROM db_clock
         RETURNING expires_at`,
        [tokenHash, adminId, ABSOLUTE_LIFETIME_HOURS],
      );
      await client.query(
        `UPDATE admin_users
            SET last_sign_in_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [adminId],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type,
           actor_admin_id,
           action,
           entity_type,
           entity_id,
           metadata
         )
         VALUES ('ADMIN', $1, 'ADMIN_SIGNED_IN', 'ADMIN_USER', $1, '{}'::jsonb)`,
        [adminId],
      );
      await client.query("COMMIT");
      return {
        token,
        admin: {
          id: row.id,
          email: row.email_normalized,
          displayName: row.display_name,
        },
        expiresAt: inserted.rows[0]!.expires_at,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async validateSession(token: string): Promise<AdminSession | null> {
    const result = await this.pool.query<SessionRow>(
      `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
       SELECT
         s.id,
         s.admin_user_id,
         a.email_normalized,
         a.display_name,
         s.created_at,
         s.last_seen_at,
         s.expires_at,
         db_clock.db_now,
         s.last_seen_at <= db_clock.db_now - make_interval(mins => $2) AS refresh_due
         FROM admin_sessions s
         JOIN admin_users a ON a.id = s.admin_user_id
         CROSS JOIN db_clock
        WHERE s.token_hash = $1
          AND a.is_active = true
          AND s.expires_at > db_clock.db_now
          AND s.last_seen_at > db_clock.db_now - make_interval(hours => $3)
      `,
      [hashSessionToken(token), LAST_SEEN_REFRESH_MINUTES, IDLE_TIMEOUT_HOURS],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    let lastSeenAt = row.last_seen_at;
    if (row.refresh_due) {
      const refreshed = await this.pool.query<{ last_seen_at: Date }>(
        `UPDATE admin_sessions
            SET last_seen_at = clock_timestamp()
          WHERE id = $1
            AND last_seen_at <= clock_timestamp() - make_interval(mins => $2)
        RETURNING last_seen_at`,
        [row.id, LAST_SEEN_REFRESH_MINUTES],
      );
      lastSeenAt = refreshed.rows[0]?.last_seen_at ?? lastSeenAt;
    }

    return {
      id: row.id,
      admin: {
        id: row.admin_user_id,
        email: row.email_normalized,
        displayName: row.display_name,
      },
      createdAt: row.created_at,
      lastSeenAt,
      expiresAt: row.expires_at,
      databaseTime: row.db_now,
    };
  }

  async deleteSession(token: string): Promise<void> {
    await this.pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [
      hashSessionToken(token),
    ]);
  }
}

export const postgresAdminAuthRepository = new PostgresAdminAuthRepository();
