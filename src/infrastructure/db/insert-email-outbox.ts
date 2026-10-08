import type { PoolClient } from "pg";

import type { EmailOutboxKind } from "@/application/notifications/email-outbox";

// Runs on the caller's transaction client so the row commits or rolls back with the business change.
export async function insertAdminEmailOutbox(
  client: Pick<PoolClient, "query">,
  input: { kind: EmailOutboxKind; adminUserId: string; payload?: Record<string, unknown> },
): Promise<void> {
  await client.query(
    "INSERT INTO email_outbox (kind, admin_user_id, payload) VALUES ($1, $2, $3::jsonb)",
    [input.kind, input.adminUserId, JSON.stringify(input.payload ?? {})],
  );
}
