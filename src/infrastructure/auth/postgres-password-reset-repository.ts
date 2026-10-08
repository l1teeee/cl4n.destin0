import type { Pool, PoolClient } from "pg";

import type {
  IssuePasswordResetTokenInput,
  PasswordResetRecipient,
  PasswordResetRepository,
} from "@/application/auth/password-recovery";

import { pool as applicationPool } from "../db/client";
import { inTransaction } from "../db/transaction";

interface AdminRecipientRow {
  id: string;
  display_name: string;
  email: string;
}

interface TokenRow {
  id: string;
  admin_user_id: string;
}

async function insertSystemAudit(
  client: PoolClient,
  action: "ADMIN_PASSWORD_RESET_REQUESTED" | "ADMIN_PASSWORD_RESET_COMPLETED",
  adminId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id, metadata)
     VALUES ('SYSTEM', $1, 'ADMIN_USER', $2, '{}'::jsonb)`,
    [action, adminId],
  );
}

export class PostgresPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  issueToken(input: IssuePasswordResetTokenInput): Promise<PasswordResetRecipient | null> {
    return inTransaction(this.pool, [], (client) => this.issueTokenIn(client, input));
  }

  private async issueTokenIn(
    client: PoolClient,
    input: IssuePasswordResetTokenInput,
  ): Promise<PasswordResetRecipient | null> {
    const admin = await client.query<AdminRecipientRow>(
      `SELECT id, display_name, email
         FROM admin_users
        WHERE email_normalized = $1
          AND is_active = true
          AND deleted_at IS NULL
        FOR NO KEY UPDATE`,
      [input.emailNormalized],
    );
    const row = admin.rows[0];
    if (!row) {
      return null;
    }

    await client.query(
      `UPDATE admin_password_reset_tokens
          SET invalidated_at = clock_timestamp()
        WHERE admin_user_id = $1
          AND consumed_at IS NULL
          AND invalidated_at IS NULL`,
      [row.id],
    );
    await client.query(
      `INSERT INTO admin_password_reset_tokens (admin_user_id, token_hash, expires_at)
       VALUES ($1, $2, clock_timestamp() + make_interval(mins => $3))`,
      [row.id, input.tokenHash, input.ttlMinutes],
    );
    await insertSystemAudit(client, "ADMIN_PASSWORD_RESET_REQUESTED", row.id);
    return { displayName: row.display_name, email: row.email };
  }

  complete(tokenHash: string, passwordHash: string): Promise<boolean> {
    return inTransaction(this.pool, [], async (client) => {
      const tokenOwner = await client.query<{ admin_user_id: string }>(
        `SELECT admin_user_id
           FROM admin_password_reset_tokens
          WHERE token_hash = $1
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
            AND expires_at > clock_timestamp()`,
        [tokenHash],
      );
      const adminId = tokenOwner.rows[0]?.admin_user_id;
      if (!adminId) {
        return false;
      }

      const admin = await client.query<{ id: string }>(
        `SELECT id
           FROM admin_users
          WHERE id = $1
            AND is_active = true
            AND deleted_at IS NULL
            FOR NO KEY UPDATE`,
        [adminId],
      );
      if (!admin.rows[0]) {
        return false;
      }

      const token = await client.query<TokenRow>(
        `SELECT id, admin_user_id
           FROM admin_password_reset_tokens
          WHERE token_hash = $1
            AND admin_user_id = $2
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
            AND expires_at > clock_timestamp()
          FOR UPDATE`,
        [tokenHash, adminId],
      );
      const tokenRow = token.rows[0];
      if (!tokenRow) {
        return false;
      }

      await client.query(
        `UPDATE admin_users
            SET password_hash = $2,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [tokenRow.admin_user_id, passwordHash],
      );
      await client.query(
        "UPDATE admin_password_reset_tokens SET consumed_at = clock_timestamp() WHERE id = $1",
        [tokenRow.id],
      );
      await client.query("DELETE FROM admin_sessions WHERE admin_user_id = $1", [
        tokenRow.admin_user_id,
      ]);
      await insertSystemAudit(client, "ADMIN_PASSWORD_RESET_COMPLETED", tokenRow.admin_user_id);
      await client.query(
        "INSERT INTO email_outbox (kind, admin_user_id) VALUES ('ADMIN_PASSWORD_RESET_COMPLETED', $1)",
        [tokenRow.admin_user_id],
      );
      return true;
    });
  }
}

export const postgresPasswordResetRepository = new PostgresPasswordResetRepository();
