import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "@/infrastructure/auth/password";
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
} from "@/infrastructure/auth/password-reset-token";
import { PostgresPasswordResetRepository } from "@/infrastructure/auth/postgres-password-reset-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const ITERATIONS = 10;
const CONCURRENT_COMPLETIONS = 8;
let pool: Pool;
let repository: PostgresPasswordResetRepository;
let passwordHash: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString(), max: 30 });
  repository = new PostgresPasswordResetRepository(pool);
  passwordHash = await hashPassword("clave-inicial-123");
});

afterAll(async () => {
  await pool.end();
});

async function insertAdmin(): Promise<{ id: string; email: string }> {
  const email = `${randomUUID()}@example.com`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
     VALUES ($1, $1, $2, 'Admin')
     RETURNING id`,
    [email, passwordHash],
  );
  return { id: result.rows[0]!.id, email };
}

async function issueToken(email: string): Promise<string> {
  const token = generatePasswordResetToken();
  await repository.issueToken({
    emailNormalized: email,
    tokenHash: hashPasswordResetToken(token),
    ttlMinutes: 30,
  });
  return token;
}

describe("password recovery concurrency", () => {
  it("lets exactly one of several simultaneous completions with the same token succeed", async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const admin = await insertAdmin();
      const token = await issueToken(admin.email);

      const results = await Promise.all(
        Array.from({ length: CONCURRENT_COMPLETIONS }, (_unused, index) =>
          repository.complete(hashPasswordResetToken(token), `hash-from-attempt-${index}`),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      const audits = await pool.query(
        "SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'ADMIN_PASSWORD_RESET_COMPLETED'",
        [admin.id],
      );
      expect(audits.rowCount).toBe(1);
      const outbox = await pool.query("SELECT 1 FROM email_outbox WHERE admin_user_id = $1", [
        admin.id,
      ]);
      expect(outbox.rowCount).toBe(1);
    }
  });

  it("keeps a single live token when requests for the same admin race", async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const admin = await insertAdmin();

      await Promise.all(
        Array.from({ length: CONCURRENT_COMPLETIONS }, () => issueToken(admin.email)),
      );

      const live = await pool.query(
        `SELECT 1 FROM admin_password_reset_tokens
          WHERE admin_user_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [admin.id],
      );
      expect(live.rowCount).toBe(1);
    }
  });

  it("does not deadlock when a request and a completion race on the same admin", async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const admin = await insertAdmin();
      const token = await issueToken(admin.email);

      const [completed] = await Promise.all([
        repository.complete(hashPasswordResetToken(token), "hash-after-reset"),
        issueToken(admin.email),
        issueToken(admin.email),
      ]);

      expect(typeof completed).toBe("boolean");
    }
  });
});
