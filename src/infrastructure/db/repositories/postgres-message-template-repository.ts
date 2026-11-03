import { createHash } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import type { RequestMessageSubject } from "@/application/messaging/conversation-queries";
import type { ManualTemplateRepository } from "@/application/messaging/manual-templates";
import type {
  MessageTemplate,
  MessageTemplateRepository,
} from "@/application/messaging/message-templates";
import { TEMPLATE_KEYS, type TemplateKey } from "@/domain/messaging/message-types";

import { pool as applicationPool } from "../client";
import { inTransaction } from "../transaction";
import { loadGuestMessageValues } from "./guest-messages";

export const MESSAGE_TEMPLATE_UUID_NAMESPACE = "bc6f0a0c-b68a-4d32-9aca-1681c6f7ea8a";

interface TemplateRow extends QueryResultRow {
  key: TemplateKey;
  body: string;
  updated_at: Date;
  updated_by_name: string | null;
}

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

export function messageTemplateAuditId(key: TemplateKey): string {
  const digest = createHash("sha1")
    .update(uuidBytes(MESSAGE_TEMPLATE_UUID_NAMESPACE))
    .update(key, "utf8")
    .digest();
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toTemplate(row: TemplateRow): MessageTemplate {
  return {
    key: row.key,
    body: row.body,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name,
  };
}

const transactionSettings = [
  "SET LOCAL lock_timeout = '3s'",
  "SET LOCAL statement_timeout = '5s'",
  "SET LOCAL idle_in_transaction_session_timeout = '5s'",
] as const;

export class PostgresMessageTemplateRepository
  implements MessageTemplateRepository, ManualTemplateRepository
{
  constructor(private readonly pool: Pool = applicationPool) {}

  async listTemplates(): Promise<MessageTemplate[]> {
    const result = await this.pool.query<TemplateRow>(
      `SELECT template.key, template.body, template.updated_at,
              admin.display_name AS updated_by_name
         FROM message_templates template
         LEFT JOIN admin_users admin ON admin.id = template.updated_by
        ORDER BY array_position($1::text[], template.key)`,
      [[...TEMPLATE_KEYS]],
    );
    return result.rows.map(toTemplate);
  }

  async loadRequestMessageValues(subject: RequestMessageSubject): Promise<Record<string, string>> {
    const client = await this.pool.connect();
    try {
      return await loadGuestMessageValues(client, subject);
    } finally {
      client.release();
    }
  }

  updateTemplate(key: TemplateKey, body: string, adminId: string): Promise<MessageTemplate> {
    return inTransaction(this.pool, transactionSettings, async (client) => {
      const updated = await client.query<TemplateRow>(
        `WITH changed AS (
           UPDATE message_templates
              SET body = $2, updated_at = clock_timestamp(), updated_by = $3
            WHERE key = $1
          RETURNING key, body, updated_at, updated_by
         )
         SELECT changed.key, changed.body, changed.updated_at,
                admin.display_name AS updated_by_name
           FROM changed
           JOIN admin_users admin ON admin.id = changed.updated_by`,
        [key, body, adminId],
      );
      const row = updated.rows[0];
      if (!row) throw new Error(`Message template ${key} does not exist.`);

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         ) VALUES ('ADMIN', $1, 'MESSAGE_TEMPLATE_UPDATED', 'MESSAGE_TEMPLATE', $2, $3::jsonb)`,
        [adminId, messageTemplateAuditId(key), JSON.stringify({ key })],
      );
      return toTemplate(row);
    });
  }
}

export const postgresMessageTemplateRepository = new PostgresMessageTemplateRepository();
