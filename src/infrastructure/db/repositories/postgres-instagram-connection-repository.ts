import type { Pool, PoolClient, QueryResultRow } from "pg";

import type {
  InstagramConnection,
  InstagramConnectionRepository,
} from "@/application/messaging/instagram-connection";
import { env } from "@/infrastructure/config/env";
import { decryptSecret, encryptSecret } from "@/infrastructure/crypto/secret-box";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";

export const INSTAGRAM_CONNECTION_AUDIT_ID = "3f6b2a10-6c1e-4d7a-9b25-8e0c4f1a7d01";

const TOKEN_CONTEXT = "instagram_connection.access_token";
const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

let encryptionKey: Buffer | undefined;

function tokenKey(): Buffer {
  if (!encryptionKey) {
    if (!env.INSTAGRAM_TOKEN_ENCRYPTION_KEY) {
      throw new Error("INSTAGRAM_TOKEN_ENCRYPTION_KEY is not configured");
    }
    encryptionKey = Buffer.from(env.INSTAGRAM_TOKEN_ENCRYPTION_KEY, "base64");
  }
  return encryptionKey;
}

interface ConnectionRow extends QueryResultRow {
  account_id: string;
  username: string;
  access_token_ciphertext: string;
  token_expires_at: Date;
  token_version: number;
  connected_by_admin_id: string | null;
  connected_at: Date;
  token_refreshed_at: Date;
}

async function insertAudit(
  client: PoolClient,
  adminId: string,
  action: "INSTAGRAM_CONNECTED" | "INSTAGRAM_DISCONNECTED",
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_type, actor_admin_id, action, entity_type, entity_id, metadata)
     VALUES ('ADMIN', $1, $2, 'INSTAGRAM_CONNECTION', $3, $4::jsonb)`,
    [adminId, action, INSTAGRAM_CONNECTION_AUDIT_ID, JSON.stringify(metadata)],
  );
}

export class PostgresInstagramConnectionRepository implements InstagramConnectionRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async find(): Promise<InstagramConnection | null> {
    const result = await this.pool.query<ConnectionRow>(
      `SELECT account_id, username, access_token_ciphertext, token_expires_at, token_version,
              connected_by_admin_id, connected_at, token_refreshed_at
         FROM instagram_connection WHERE id = 1`,
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      accountId: row.account_id,
      username: row.username,
      accessToken: decryptSecret(row.access_token_ciphertext, tokenKey(), TOKEN_CONTEXT),
      tokenExpiresAt: row.token_expires_at,
      tokenVersion: row.token_version,
      connectedByAdminId: row.connected_by_admin_id,
      connectedAt: row.connected_at,
      tokenRefreshedAt: row.token_refreshed_at,
    };
  }

  // Health checks must keep working even when the token cannot be decrypted.
  async findTokenExpiry(): Promise<Date | null> {
    const result = await this.pool.query<{ token_expires_at: Date }>(
      "SELECT token_expires_at FROM instagram_connection WHERE id = 1",
    );
    return result.rows[0]?.token_expires_at ?? null;
  }

  async save(input: Parameters<InstagramConnectionRepository["save"]>[0]): Promise<void> {
    const ciphertext = encryptSecret(input.accessToken, tokenKey(), TOKEN_CONTEXT);
    await inTransaction(this.pool, transactionSettings, async (client) => {
      await client.query(
        `INSERT INTO instagram_connection
           (id, account_id, username, access_token_ciphertext, token_expires_at, connected_by_admin_id)
         VALUES (1, $1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           account_id = EXCLUDED.account_id, username = EXCLUDED.username,
           access_token_ciphertext = EXCLUDED.access_token_ciphertext,
           token_expires_at = EXCLUDED.token_expires_at,
           connected_by_admin_id = EXCLUDED.connected_by_admin_id,
           token_version = instagram_connection.token_version + 1,
           connected_at = now(), token_refreshed_at = now()`,
        [input.accountId, input.username, ciphertext, input.tokenExpiresAt, input.adminId],
      );
      await insertAudit(client, input.adminId, "INSTAGRAM_CONNECTED", {
        username: input.username,
        accountId: input.accountId,
      });
    });
  }

  async replaceToken(
    input: Parameters<InstagramConnectionRepository["replaceToken"]>[0],
  ): Promise<boolean> {
    const ciphertext = encryptSecret(input.accessToken, tokenKey(), TOKEN_CONTEXT);
    const result = await this.pool.query(
      `UPDATE instagram_connection
          SET access_token_ciphertext = $1, token_expires_at = $2,
              token_refreshed_at = now(), token_version = token_version + 1
        WHERE id = 1 AND token_version = $3`,
      [ciphertext, input.tokenExpiresAt, input.expectedVersion],
    );
    return result.rowCount === 1;
  }

  delete(adminId: string): Promise<boolean> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const result = await client.query<{ username: string }>(
        "DELETE FROM instagram_connection WHERE id = 1 RETURNING username",
      );
      if (!result.rows[0]) return false;
      await insertAudit(client, adminId, "INSTAGRAM_DISCONNECTED", {
        username: result.rows[0].username,
      });
      return true;
    });
  }
}

export const postgresInstagramConnectionRepository = new PostgresInstagramConnectionRepository();
