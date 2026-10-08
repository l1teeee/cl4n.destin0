import { timingSafeEqual } from "node:crypto";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { AdminUserRepository } from "@/application/admin-users/admin-user-repository";
import type {
  AdminUserErrorCode,
  AdminDeletionCodeRecord,
  AdminUserResult,
  AdminUserSummary,
  CreateAdminUserCommand,
  SessionRevocation,
  UpdateAdminUserCommand,
} from "@/application/admin-users/types";
import type { AuditLogItem } from "@/application/events/types";
import { checkAccessChange, type AdminRole } from "@/domain/admin/admin-access";

import { ADMIN_SESSION_IDLE_TIMEOUT_HOURS } from "../../auth/session-store";
import { pool as applicationPool } from "../client";
import { inTransaction as runInTransaction } from "../transaction";

interface AdminUserRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  role: AdminRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  last_sign_in_at: Date | null;
  active_session_count: number;
}

interface LockedAdminRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  role: AdminRole;
  is_active: boolean;
}

interface DeletionCodeRow extends QueryResultRow {
  id: string;
  code_hash: string;
  expired: boolean;
}

type Executor = Pick<Pool | PoolClient, "query">;

const summarySelect = `
  SELECT a.id,
         a.email,
         a.display_name,
         a.role,
         a.is_active,
         a.created_at,
         a.updated_at,
         a.last_sign_in_at,
         (SELECT count(*)::int
            FROM admin_sessions s
           WHERE s.admin_user_id = a.id
             AND s.expires_at > clock_timestamp()
             AND s.last_seen_at > clock_timestamp() - make_interval(hours => $1)
         ) AS active_session_count
    FROM admin_users a`;

function summary(row: AdminUserRow): AdminUserSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSignInAt: row.last_sign_in_at,
    activeSessionCount: row.active_session_count,
  };
}

function successful<T>(value: T): AdminUserResult<T> {
  return { ok: true, value };
}

function failed<T>(error: AdminUserErrorCode): AdminUserResult<T> {
  return { ok: false, error };
}

function isEmailViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "admin_users_email_normalized_live_uq"
  );
}

function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return runInTransaction(
    pool,
    ["SET LOCAL lock_timeout = '5s'", "SET LOCAL idle_in_transaction_session_timeout = '5s'"],
    work,
  );
}

async function selectSummary(executor: Executor, id: string): Promise<AdminUserSummary | null> {
  const result = await executor.query<AdminUserRow>(
    `${summarySelect} WHERE a.id = $2 AND a.deleted_at IS NULL`,
    [ADMIN_SESSION_IDLE_TIMEOUT_HOURS, id],
  );
  const row = result.rows[0];
  return row ? summary(row) : null;
}

async function lockActiveSuperAdmins(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM admin_users
      WHERE role = 'SUPER_ADMIN'
        AND is_active = true
        AND deleted_at IS NULL
      ORDER BY id
      FOR NO KEY UPDATE`,
  );
  return result.rows.map((row) => row.id);
}

async function lockAdmin(client: PoolClient, id: string): Promise<LockedAdminRow | null> {
  const result = await client.query<LockedAdminRow>(
    `SELECT id, email, display_name, role, is_active
       FROM admin_users
      WHERE id = $1
        AND deleted_at IS NULL
      FOR NO KEY UPDATE`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function deleteSessions(client: PoolClient, adminId: string): Promise<number> {
  const result = await client.query("DELETE FROM admin_sessions WHERE admin_user_id = $1", [
    adminId,
  ]);
  return result.rowCount ?? 0;
}

async function insertAudit(
  client: PoolClient,
  actorAdminId: string,
  action: AuditLogItem["action"],
  adminUserId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type,
       actor_admin_id,
       action,
       entity_type,
       entity_id,
       metadata
     )
     VALUES ('ADMIN', $1, $2, 'ADMIN_USER', $3, $4::jsonb)`,
    [actorAdminId, action, adminUserId, JSON.stringify(metadata)],
  );
}

function hashesMatch(storedHash: string, suppliedHash: string): boolean {
  const stored = Buffer.from(storedHash, "hex");
  const supplied = Buffer.from(suppliedHash, "hex");
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

export class PostgresAdminUserRepository implements AdminUserRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async list(): Promise<AdminUserSummary[]> {
    const result = await this.pool.query<AdminUserRow>(
      `${summarySelect}
       WHERE a.deleted_at IS NULL
       ORDER BY a.is_active DESC, a.role, a.display_name, a.id`,
      [ADMIN_SESSION_IDLE_TIMEOUT_HOURS],
    );
    return result.rows.map(summary);
  }

  findById(id: string): Promise<AdminUserSummary | null> {
    return selectSummary(this.pool, id);
  }

  async create(
    actorId: string,
    command: CreateAdminUserCommand,
  ): Promise<AdminUserResult<AdminUserSummary>> {
    try {
      return await this.asSuperAdmin(actorId, async (client) => {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            command.email,
            command.emailNormalized,
            command.passwordHash,
            command.displayName,
            command.role,
          ],
        );
        const id = inserted.rows[0]!.id;
        await insertAudit(client, actorId, "ADMIN_USER_CREATED", id, { role: command.role });
        return successful((await selectSummary(client, id))!);
      });
    } catch (error) {
      if (isEmailViolation(error)) {
        return failed("EMAIL_TAKEN");
      }
      throw error;
    }
  }

  update(
    actorId: string,
    command: UpdateAdminUserCommand,
  ): Promise<AdminUserResult<AdminUserSummary>> {
    return this.asSuperAdmin(actorId, async (client, activeSuperAdminIds) => {
      const target = await lockAdmin(client, command.id);
      if (!target) {
        return failed("NOT_FOUND");
      }
      if (target.role !== command.expectedRole) {
        return failed("ROLE_CHANGED");
      }

      const violation = checkAccessChange({
        actorId,
        targetId: target.id,
        current: { role: target.role, isActive: target.is_active },
        next: { role: command.role, isActive: target.is_active },
        activeSuperAdminIds,
      });
      if (violation) {
        return failed(violation);
      }

      const metadata: Record<string, unknown> = {};
      if (target.role !== command.role) {
        metadata.role = { from: target.role, to: command.role };
      }
      if (target.display_name !== command.displayName) {
        metadata.displayNameChanged = true;
      }
      if (Object.keys(metadata).length > 0) {
        await client.query(
          `UPDATE admin_users
              SET display_name = $2,
                  role = $3,
                  updated_at = clock_timestamp()
            WHERE id = $1`,
          [target.id, command.displayName, command.role],
        );
        await insertAudit(client, actorId, "ADMIN_USER_UPDATED", target.id, metadata);
      }
      return successful((await selectSummary(client, target.id))!);
    });
  }

  deactivate(actorId: string, id: string): Promise<AdminUserResult<SessionRevocation>> {
    return this.asSuperAdmin(actorId, async (client, activeSuperAdminIds) => {
      const target = await lockAdmin(client, id);
      if (!target) {
        return failed("NOT_FOUND");
      }
      if (!target.is_active) {
        return failed("ALREADY_INACTIVE");
      }

      const violation = checkAccessChange({
        actorId,
        targetId: target.id,
        current: { role: target.role, isActive: true },
        next: { role: target.role, isActive: false },
        activeSuperAdminIds,
      });
      if (violation) {
        return failed(violation);
      }

      await client.query(
        `UPDATE admin_users
            SET is_active = false,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [target.id],
      );
      const revokedSessions = await deleteSessions(client, target.id);
      await insertAudit(client, actorId, "ADMIN_USER_DEACTIVATED", target.id, {
        revokedSessions,
      });
      return successful({ revokedSessions });
    });
  }

  reactivate(actorId: string, id: string): Promise<AdminUserResult<AdminUserSummary>> {
    return this.asSuperAdmin(actorId, async (client) => {
      const target = await lockAdmin(client, id);
      if (!target) {
        return failed("NOT_FOUND");
      }
      if (target.is_active) {
        return failed("ALREADY_ACTIVE");
      }

      await client.query(
        `UPDATE admin_users
            SET is_active = true,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [target.id],
      );
      await insertAudit(client, actorId, "ADMIN_USER_REACTIVATED", target.id, {});
      return successful((await selectSummary(client, target.id))!);
    });
  }

  resetPassword(
    actorId: string,
    id: string,
    passwordHash: string,
  ): Promise<AdminUserResult<SessionRevocation>> {
    return this.asSuperAdmin(actorId, async (client) => {
      if (actorId === id) {
        return failed("SELF_ACTION");
      }
      const target = await lockAdmin(client, id);
      if (!target) {
        return failed("NOT_FOUND");
      }

      await client.query(
        `UPDATE admin_users
            SET password_hash = $2,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [target.id, passwordHash],
      );
      const revokedSessions = await deleteSessions(client, target.id);
      await insertAudit(client, actorId, "ADMIN_PASSWORD_RESET", target.id, { revokedSessions });
      return successful({ revokedSessions });
    });
  }

  revokeSessions(actorId: string, id: string): Promise<AdminUserResult<SessionRevocation>> {
    return this.asSuperAdmin(actorId, async (client) => {
      if (actorId === id) {
        return failed("SELF_ACTION");
      }
      const target = await lockAdmin(client, id);
      if (!target) {
        return failed("NOT_FOUND");
      }

      const revokedSessions = await deleteSessions(client, target.id);
      await insertAudit(client, actorId, "ADMIN_SESSIONS_REVOKED", target.id, {
        revokedSessions,
      });
      return successful({ revokedSessions });
    });
  }

  async findActivePasswordHash(id: string): Promise<string | null> {
    const result = await this.pool.query<{ password_hash: string }>(
      `SELECT password_hash
         FROM admin_users
        WHERE id = $1
          AND is_active = true
          AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0]?.password_hash ?? null;
  }

  changeOwnPassword(
    adminId: string,
    keepSessionId: string,
    expectedPasswordHash: string,
    passwordHash: string,
  ): Promise<AdminUserResult<SessionRevocation>> {
    return inTransaction(this.pool, async (client) => {
      const updated = await client.query(
        `UPDATE admin_users
            SET password_hash = $3,
                updated_at = clock_timestamp()
          WHERE id = $1
            AND is_active = true
            AND deleted_at IS NULL
            AND password_hash = $2`,
        [adminId, expectedPasswordHash, passwordHash],
      );
      if (updated.rowCount !== 1) {
        return failed<SessionRevocation>("INVALID_CURRENT_PASSWORD");
      }

      const deleted = await client.query(
        "DELETE FROM admin_sessions WHERE admin_user_id = $1 AND id <> $2",
        [adminId, keepSessionId],
      );
      const revokedSessions = deleted.rowCount ?? 0;
      await insertAudit(client, adminId, "ADMIN_PASSWORD_CHANGED", adminId, { revokedSessions });
      return successful({ revokedSessions });
    });
  }

  createDeletionCode(
    actorId: string,
    targetId: string,
    codeHash: string,
  ): Promise<AdminUserResult<AdminDeletionCodeRecord>> {
    return this.asSuperAdmin(actorId, async (client) => {
      const target = await lockAdmin(client, targetId);
      if (!target) {
        return failed("NOT_FOUND");
      }

      await client.query(
        `UPDATE admin_action_codes
            SET invalidated_at = clock_timestamp()
          WHERE actor_admin_id = $1
            AND target_admin_id = $2
            AND purpose = 'ADMIN_USER_DELETE'
            AND consumed_at IS NULL
            AND invalidated_at IS NULL`,
        [actorId, targetId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO admin_action_codes (
           purpose,
           actor_admin_id,
           target_admin_id,
           code_hash,
           expires_at
         )
         VALUES (
           'ADMIN_USER_DELETE',
           $1,
           $2,
           $3,
           clock_timestamp() + interval '10 minutes'
         )
         RETURNING id`,
        [actorId, targetId, codeHash],
      );
      const codeId = inserted.rows[0]!.id;
      await insertAudit(client, actorId, "ADMIN_USER_DELETION_REQUESTED", targetId, {});
      return successful({
        codeId,
        target: { displayName: target.display_name, email: target.email },
        expiresInMinutes: 10,
      });
    });
  }

  async invalidateCode(codeId: string): Promise<void> {
    await this.pool.query(
      `UPDATE admin_action_codes
          SET invalidated_at = clock_timestamp()
        WHERE id = $1
          AND consumed_at IS NULL
          AND invalidated_at IS NULL`,
      [codeId],
    );
  }

  deleteWithCode(
    actorId: string,
    targetId: string,
    codeHash: string,
  ): Promise<AdminUserResult<SessionRevocation>> {
    return this.asSuperAdmin(actorId, async (client, activeSuperAdminIds) => {
      const codeResult = await client.query<DeletionCodeRow>(
        `SELECT id,
                code_hash,
                expires_at <= clock_timestamp() AS expired
           FROM admin_action_codes
          WHERE actor_admin_id = $1
            AND target_admin_id = $2
            AND purpose = 'ADMIN_USER_DELETE'
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
          FOR UPDATE`,
        [actorId, targetId],
      );
      const code = codeResult.rows[0];
      if (!code) {
        return failed("CODE_INVALID");
      }
      if (code.expired) {
        await client.query(
          "UPDATE admin_action_codes SET invalidated_at = clock_timestamp() WHERE id = $1",
          [code.id],
        );
        return failed("CODE_EXPIRED");
      }
      if (!hashesMatch(code.code_hash, codeHash)) {
        const updated = await client.query<{ attempts: number }>(
          `UPDATE admin_action_codes
              SET attempts = attempts + 1,
                  invalidated_at = CASE
                    WHEN attempts + 1 >= 5 THEN clock_timestamp()
                    ELSE invalidated_at
                  END
            WHERE id = $1
            RETURNING attempts`,
          [code.id],
        );
        return failed(updated.rows[0]!.attempts >= 5 ? "TOO_MANY_ATTEMPTS" : "CODE_INVALID");
      }

      const target = await lockAdmin(client, targetId);
      if (!target) {
        return failed("NOT_FOUND");
      }
      const violation = checkAccessChange({
        actorId,
        targetId,
        current: { role: target.role, isActive: target.is_active },
        next: { role: target.role, isActive: false },
        activeSuperAdminIds,
      });
      if (violation) {
        return failed(violation);
      }

      await client.query(
        "UPDATE admin_action_codes SET consumed_at = clock_timestamp() WHERE id = $1",
        [code.id],
      );
      await client.query(
        `UPDATE admin_users
            SET deleted_at = clock_timestamp(),
                is_active = false,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [targetId],
      );
      const revokedSessions = await deleteSessions(client, targetId);
      await client.query(
        `UPDATE admin_action_codes
            SET invalidated_at = clock_timestamp()
          WHERE target_admin_id = $1
            AND consumed_at IS NULL
            AND invalidated_at IS NULL`,
        [targetId],
      );
      await insertAudit(client, actorId, "ADMIN_USER_DELETED", targetId, { revokedSessions });
      return successful({ revokedSessions });
    });
  }

  private asSuperAdmin<T>(
    actorId: string,
    work: (client: PoolClient, activeSuperAdminIds: string[]) => Promise<AdminUserResult<T>>,
  ): Promise<AdminUserResult<T>> {
    return inTransaction(this.pool, async (client) => {
      const activeSuperAdminIds = await lockActiveSuperAdmins(client);
      if (!activeSuperAdminIds.includes(actorId)) {
        return failed<T>("FORBIDDEN");
      }
      return work(client, activeSuperAdminIds);
    });
  }
}

export const postgresAdminUserRepository = new PostgresAdminUserRepository();
