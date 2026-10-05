import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdminUserResult } from "@/application/admin-users/types";
import type { AdminRole } from "@/application/auth/types";
import { hashPassword } from "@/infrastructure/auth/password";
import { PostgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const ITERATIONS = 25;
let pool: Pool;
let users: PostgresAdminUserRepository;
let passwordHash: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString(), max: 30 });
  users = new PostgresAdminUserRepository(pool);
  passwordHash = await hashPassword("clave-inicial-123");
});

afterAll(async () => {
  await pool.end();
});

async function insertAdmin(role: AdminRole): Promise<string> {
  const email = `${randomUUID()}@example.com`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
     VALUES ($1, $1, $2, 'Admin', $3)
     RETURNING id`,
    [email, passwordHash, role],
  );
  return result.rows[0]!.id;
}

async function freshSuperAdminPair(): Promise<[string, string]> {
  await pool.query("UPDATE admin_users SET is_active = false WHERE role = 'SUPER_ADMIN'");
  return [await insertAdmin("SUPER_ADMIN"), await insertAdmin("SUPER_ADMIN")];
}

async function activeSuperAdminCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM admin_users WHERE role = 'SUPER_ADMIN' AND is_active",
  );
  return result.rows[0]!.count;
}

function summarize(results: AdminUserResult<unknown>[]) {
  return {
    succeeded: results.filter((result) => result.ok).length,
    errors: results.flatMap((result) => (result.ok ? [] : [result.error])),
  };
}

describe("admin user concurrency", () => {
  it(`keeps exactly one super admin when two demote each other (${ITERATIONS} rounds)`, async () => {
    for (let round = 0; round < ITERATIONS; round += 1) {
      const [first, second] = await freshSuperAdminPair();
      const results = await Promise.all([
        users.update(first, { id: second, displayName: "Admin", role: "ADMIN" }),
        users.update(second, { id: first, displayName: "Admin", role: "ADMIN" }),
      ]);

      expect(summarize(results)).toEqual({ succeeded: 1, errors: ["FORBIDDEN"] });
      expect(await activeSuperAdminCount()).toBe(1);
    }
  });

  it(`keeps exactly one super admin when two deactivate each other (${ITERATIONS} rounds)`, async () => {
    for (let round = 0; round < ITERATIONS; round += 1) {
      const [first, second] = await freshSuperAdminPair();
      const results = await Promise.all([
        users.deactivate(first, second),
        users.deactivate(second, first),
      ]);

      expect(summarize(results)).toEqual({ succeeded: 1, errors: ["FORBIDDEN"] });
      expect(await activeSuperAdminCount()).toBe(1);
    }
  });

  it(`keeps a super admin when demotion races deactivation (${ITERATIONS} rounds)`, async () => {
    for (let round = 0; round < ITERATIONS; round += 1) {
      const [first, second] = await freshSuperAdminPair();
      const results = await Promise.all([
        users.deactivate(first, second),
        users.update(second, { id: first, displayName: "Admin", role: "ADMIN" }),
      ]);

      expect(summarize(results).succeeded).toBe(1);
      expect(await activeSuperAdminCount()).toBe(1);
    }
  });

  it("creates exactly one admin from 20 simultaneous requests with the same email", async () => {
    const [actor] = await freshSuperAdminPair();
    const email = `same.${randomUUID()}@example.com`;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        users.create(actor, {
          email,
          emailNormalized: email,
          displayName: "Mismo",
          role: "ADMIN",
          passwordHash,
        }),
      ),
    );

    expect(summarize(results)).toEqual({
      succeeded: 1,
      errors: Array.from({ length: 19 }, () => "EMAIL_TAKEN"),
    });
    const stored = await pool.query("SELECT 1 FROM admin_users WHERE email_normalized = $1", [
      email,
    ]);
    expect(stored.rowCount).toBe(1);
  });

  it("applies only one of two simultaneous password changes from the same current password", async () => {
    const adminId = await insertAdmin("ADMIN");
    const [newFirst, newSecond] = await Promise.all([
      hashPassword("primera-clave-nueva"),
      hashPassword("segunda-clave-nueva"),
    ]);
    const results = await Promise.all([
      users.changeOwnPassword(adminId, randomUUID(), passwordHash, newFirst),
      users.changeOwnPassword(adminId, randomUUID(), passwordHash, newSecond),
    ]);

    expect(summarize(results)).toEqual({ succeeded: 1, errors: ["INVALID_CURRENT_PASSWORD"] });
  });
});
