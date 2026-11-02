import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/config/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      MESSAGING_MODE: "instagram",
      INSTAGRAM_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  };
});

import {
  INSTAGRAM_CONNECTION_AUDIT_ID,
  PostgresInstagramConnectionRepository,
} from "@/infrastructure/db/repositories/postgres-instagram-connection-repository";
import { pool as applicationPool } from "@/infrastructure/db/client";
import {
  drainMessageOutbox,
  drainMessagesNow,
} from "@/infrastructure/messaging/drain-message-outbox";
import {
  ingestConfiguredInstagramEvents,
  retryConfiguredInboundImages,
} from "@/infrastructure/messaging/ingest-instagram-events";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresInstagramConnectionRepository;
let adminId: string;
const expires = new Date("2027-01-01T12:00:00Z");

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresInstagramConnectionRepository(pool);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
     VALUES ('instagram@example.com', 'instagram@example.com', 'test-hash', 'Instagram Admin', 'SUPER_ADMIN')
     RETURNING id`,
  );
  adminId = admin.rows[0]!.id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM instagram_connection");
});

afterAll(async () => {
  await pool.end();
  await applicationPool.end();
});

function input() {
  return {
    accountId: "123456",
    username: `account.${randomUUID()}`,
    accessToken: "private-test-token",
    tokenExpiresAt: expires,
    adminId,
  };
}

describe("PostgresInstagramConnectionRepository", () => {
  it("encrypts at rest, decrypts on find and writes the connected audit", async () => {
    expect(await repository.find()).toBeNull();
    const saved = input();
    await repository.save(saved);
    const stored = await pool.query<{ access_token_ciphertext: string }>(
      "SELECT access_token_ciphertext FROM instagram_connection WHERE id = 1",
    );
    expect(stored.rows[0]!.access_token_ciphertext).not.toBe(saved.accessToken);
    expect(stored.rows[0]!.access_token_ciphertext).toMatch(/^v1\./);
    expect(await repository.find()).toEqual({
      accountId: saved.accountId,
      username: saved.username,
      accessToken: saved.accessToken,
      tokenExpiresAt: expires,
      tokenVersion: 1,
      connectedByAdminId: adminId,
      connectedAt: expect.any(Date),
      tokenRefreshedAt: expect.any(Date),
    });
    const audit = await pool.query(
      "SELECT actor_type, actor_admin_id, entity_type, entity_id, metadata FROM audit_logs WHERE action = 'INSTAGRAM_CONNECTED' AND metadata->>'username' = $1",
      [saved.username],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "ADMIN",
        actor_admin_id: adminId,
        entity_type: "INSTAGRAM_CONNECTION",
        entity_id: INSTAGRAM_CONNECTION_AUDIT_ID,
        metadata: { username: saved.username, accountId: saved.accountId },
      },
    ]);
  });

  it("upserts the singleton, increments its version and refuses stale replacements", async () => {
    const saved = input();
    await repository.save(saved);
    await repository.save({ ...saved, accessToken: "reconnected-token" });
    const before = await repository.find();
    expect(before!.tokenVersion).toBe(2);
    expect(before!.accessToken).toBe("reconnected-token");
    const rawBefore = await pool.query("SELECT * FROM instagram_connection");
    expect(
      await repository.replaceToken({
        expectedVersion: 1,
        accessToken: "stale-token",
        tokenExpiresAt: new Date("2028-01-01"),
      }),
    ).toBe(false);
    expect((await pool.query("SELECT * FROM instagram_connection")).rows).toEqual(rawBefore.rows);
    expect(
      await repository.replaceToken({
        expectedVersion: 2,
        accessToken: "refreshed-token",
        tokenExpiresAt: new Date("2028-01-01"),
      }),
    ).toBe(true);
    expect(await repository.find()).toEqual({
      ...before,
      accessToken: "refreshed-token",
      tokenVersion: 3,
      tokenExpiresAt: new Date("2028-01-01"),
      tokenRefreshedAt: expect.any(Date),
    });
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM instagram_connection")).rows[0].count,
    ).toBe(1);
  });

  it("deletes and audits exactly once", async () => {
    const saved = input();
    await repository.save(saved);
    expect(await repository.delete(adminId)).toBe(true);
    expect(await repository.find()).toBeNull();
    expect(await repository.delete(adminId)).toBe(false);
    const audit = await pool.query(
      "SELECT actor_admin_id, entity_type, entity_id, metadata FROM audit_logs WHERE action = 'INSTAGRAM_DISCONNECTED' AND metadata->>'username' = $1",
      [saved.username],
    );
    expect(audit.rows).toEqual([
      {
        actor_admin_id: adminId,
        entity_type: "INSTAGRAM_CONNECTION",
        entity_id: INSTAGRAM_CONNECTION_AUDIT_ID,
        metadata: { username: saved.username },
      },
    ]);
  });

  it("rolls back a save if its admin foreign key fails", async () => {
    await expect(repository.save({ ...input(), adminId: randomUUID() })).rejects.toMatchObject({
      code: "23503",
    });
    expect(await repository.find()).toBeNull();
  });

  it("rolls back deletion when its audit cannot be written", async () => {
    await repository.save(input());
    const before = await repository.find();
    await expect(repository.delete(randomUUID())).rejects.toMatchObject({ code: "23503" });
    expect(await repository.find()).toEqual(before);
  });

  it("leaves messages untouched and skips image work without a connection", async () => {
    const contact = await pool.query<{ id: string }>(
      `INSERT INTO messaging_contacts (instagram_scoped_id, last_inbound_at)
       VALUES ('12345678901234', now()) RETURNING id`,
    );
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO messages (contact_id, direction, kind, source, status, body)
       VALUES ($1, 'OUTBOUND', 'FREE_TEXT', 'SYSTEM', 'QUEUED', 'pending without connection')
       RETURNING id`,
      [contact.rows[0]!.id],
    );
    const id = inserted.rows[0]!.id;
    const before = await pool.query("SELECT * FROM messages WHERE id = $1", [id]);
    const empty = { sent: 0, retried: 0, failed: 0, waitingWindow: 0, discarded: 0, outcomes: {} };
    await expect(drainMessageOutbox({ limit: 50, timeBudgetMs: 1000 })).resolves.toEqual(empty);
    await expect(drainMessagesNow([id], { timeBudgetMs: 1000 })).resolves.toEqual(empty);
    await expect(retryConfiguredInboundImages()).resolves.toBeUndefined();
    await expect(ingestConfiguredInstagramEvents([], { ownAccountId: null })).rejects.toThrow(
      "Instagram is not connected",
    );
    expect((await pool.query("SELECT * FROM messages WHERE id = $1", [id])).rows).toEqual(
      before.rows,
    );
  });
});
