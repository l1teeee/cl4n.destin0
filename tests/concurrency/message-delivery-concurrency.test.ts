import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { deliverPendingMessages } from "@/application/messaging/deliver-messages";
import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import { PostgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString(), max: 10 });
});

afterAll(async () => {
  await pool.end();
});

describe("message delivery concurrency", () => {
  it("two simultaneous drains never send the same row twice", async () => {
    const contact = await pool.query<{ id: string }>(
      `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
       VALUES ('99990001', clock_timestamp()) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO messages (contact_id, direction, kind, source, status, body)
       VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'ADMIN', 'QUEUED', 'once')`,
      [contact.rows[0]!.id],
    );

    const sendText = vi.fn(async () => ({ messageId: "single-mid" }));
    const messenger: InstagramMessenger = {
      sendText,
      sendImage: vi.fn(),
      fetchProfile: vi.fn(),
      downloadImage: vi.fn(),
    };
    const dependencies = () => ({
      repository: new PostgresMessageRepository(pool),
      messenger,
      now: Date.now,
      logFailure: vi.fn(),
      logStaleLease: vi.fn(),
    });

    await Promise.all([
      deliverPendingMessages(dependencies(), { limit: 1, timeBudgetMs: 5_000 }),
      deliverPendingMessages(dependencies(), { limit: 1, timeBudgetMs: 5_000 }),
    ]);

    expect(sendText).toHaveBeenCalledOnce();
    const row = await pool.query<{ status: string; external_message_id: string }>(
      "SELECT status, external_message_id FROM messages WHERE body = 'once'",
    );
    expect(row.rows).toEqual([{ status: "SENT", external_message_id: "single-mid" }]);
  });
});
