import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signIn } from "@/application/auth/sign-in";
import { signOut } from "@/application/auth/sign-out";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/infrastructure/auth/password";
import { authorizeAdminSession } from "@/infrastructure/auth/require-admin";
import { hashSessionToken, PostgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { consumeWithPool } from "@/infrastructure/rate-limit/postgres-rate-limiter";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

let pool: Pool;
let repository: PostgresAdminAuthRepository;

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  repository = new PostgresAdminAuthRepository(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE admin_sessions, rate_limit_counters");
});

afterAll(async () => {
  await pool.end();
});

async function insertAdmin(options: { active?: boolean; password?: string } = {}) {
  const email = `${randomUUID()}@example.com`;
  const passwordHash = await hashPassword(options.password ?? "valid-password-123");
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (
       email, email_normalized, password_hash, display_name, is_active
     )
     VALUES ($1, $1, $2, 'Admin de prueba', $3)
     RETURNING id`,
    [email, passwordHash, options.active ?? true],
  );
  return { id: result.rows[0]!.id, email, passwordHash };
}

function realSignIn(email: string, password: string, clientIp: string = randomUUID()) {
  return signIn(
    { email, password, clientIp, rawClientIp: null },
    {
      repository,
      consumeRateLimit: (input) => consumeWithPool(input, pool),
      passwordVerifier: verifyPassword,
      dummyPasswordHash: DUMMY_PASSWORD_HASH,
    },
  );
}

describe("admin sign-in", () => {
  it("creates a session, stores only its hash, updates the admin, and audits", async () => {
    const admin = await insertAdmin();
    const before = new Date();
    const result = await realSignIn(admin.email, "valid-password-123");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Buffer.from(result.token, "base64url")).toHaveLength(32);
    const session = await pool.query<{
      token_hash: string;
      created_at: Date;
      expires_at: Date;
    }>("SELECT token_hash, created_at, expires_at FROM admin_sessions WHERE admin_user_id = $1", [
      admin.id,
    ]);
    expect(session.rows[0]!.token_hash).toBe(hashSessionToken(result.token));
    expect(session.rows[0]!.token_hash).not.toContain(result.token);
    expect(session.rows[0]!.expires_at.getTime() - session.rows[0]!.created_at.getTime()).toBe(
      12 * 60 * 60 * 1000,
    );
    const storedAdmin = await pool.query<{ last_sign_in_at: Date | null }>(
      "SELECT last_sign_in_at FROM admin_users WHERE id = $1",
      [admin.id],
    );
    expect(storedAdmin.rows[0]!.last_sign_in_at!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    const audit = await pool.query(
      `SELECT actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         FROM audit_logs
        WHERE entity_id = $1`,
      [admin.id],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "ADMIN",
        actor_admin_id: admin.id,
        action: "ADMIN_SIGNED_IN",
        entity_type: "ADMIN_USER",
        entity_id: admin.id,
        metadata: {},
      },
    ]);
  });

  it("rate-limits an email after five failed attempts", async () => {
    const email = `${randomUUID()}@example.com`;
    const outcomes = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      outcomes.push(await realSignIn(email, "wrong-password", `ip-${attempt}`));
    }
    expect(outcomes.slice(0, 5)).toEqual(
      Array.from({ length: 5 }, () => ({ ok: false, error: "INVALID_CREDENTIALS" })),
    );
    expect(outcomes[5]).toMatchObject({ ok: false, error: "RATE_LIMITED" });
  });
});

describe("session creation preconditions", () => {
  it("returns null without a session or audit when the verified password hash changed", async () => {
    const admin = await insertAdmin();
    await pool.query("UPDATE admin_users SET password_hash = $2 WHERE id = $1", [
      admin.id,
      await hashPassword("replacement-password-123"),
    ]);

    await expect(repository.createSession(admin.id, admin.passwordHash, null)).resolves.toBeNull();
    await expect(
      pool.query("SELECT 1 FROM admin_sessions WHERE admin_user_id = $1", [admin.id]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      pool.query(
        "SELECT 1 FROM audit_logs WHERE actor_admin_id = $1 AND action = 'ADMIN_SIGNED_IN'",
        [admin.id],
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it("returns null without a session or audit when the admin was deactivated", async () => {
    const admin = await insertAdmin();
    await pool.query("UPDATE admin_users SET is_active = false WHERE id = $1", [admin.id]);

    await expect(repository.createSession(admin.id, admin.passwordHash, null)).resolves.toBeNull();
    await expect(
      pool.query("SELECT 1 FROM admin_sessions WHERE admin_user_id = $1", [admin.id]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      pool.query(
        "SELECT 1 FROM audit_logs WHERE actor_admin_id = $1 AND action = 'ADMIN_SIGNED_IN'",
        [admin.id],
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });

  it("creates and audits a session with the current password hash", async () => {
    const admin = await insertAdmin();

    await expect(
      repository.createSession(admin.id, admin.passwordHash, null),
    ).resolves.toMatchObject({
      admin: { id: admin.id },
    });
    await expect(
      pool.query("SELECT 1 FROM admin_sessions WHERE admin_user_id = $1", [admin.id]),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query(
        "SELECT 1 FROM audit_logs WHERE actor_admin_id = $1 AND action = 'ADMIN_SIGNED_IN'",
        [admin.id],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe("session validation", () => {
  it("rejects missing and invalid tokens", async () => {
    await expect(authorizeAdminSession(undefined, repository)).resolves.toEqual({
      authorized: false,
      error: "UNAUTHORIZED",
    });
    await expect(authorizeAdminSession("invalid", repository)).resolves.toEqual({
      authorized: false,
      error: "UNAUTHORIZED",
    });
  });

  it("rejects absolute expiry", async () => {
    const admin = await insertAdmin();
    const session = (await repository.createSession(admin.id, admin.passwordHash, null))!;
    await pool.query(
      "UPDATE admin_sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE admin_user_id = $1",
      [admin.id],
    );
    await expect(authorizeAdminSession(session.token, repository)).resolves.toEqual({
      authorized: false,
      error: "UNAUTHORIZED",
    });
  });

  it("rejects idle expiry", async () => {
    const admin = await insertAdmin();
    const session = (await repository.createSession(admin.id, admin.passwordHash, null))!;
    await pool.query(
      "UPDATE admin_sessions SET last_seen_at = clock_timestamp() - interval '2 hours 1 second' WHERE admin_user_id = $1",
      [admin.id],
    );
    await expect(repository.validateSession(session.token)).resolves.toBeNull();
  });

  it("rejects a session whose admin became inactive", async () => {
    const admin = await insertAdmin();
    const session = (await repository.createSession(admin.id, admin.passwordHash, null))!;
    await pool.query("UPDATE admin_users SET is_active = false WHERE id = $1", [admin.id]);
    await expect(authorizeAdminSession(session.token, repository)).resolves.toEqual({
      authorized: false,
      error: "UNAUTHORIZED",
    });
  });

  it("does not write before five minutes and refreshes only when due", async () => {
    const admin = await insertAdmin();
    const created = (await repository.createSession(admin.id, admin.passwordHash, null))!;
    const original = await pool.query<{ xmin: string; last_seen_at: Date }>(
      "SELECT xmin::text, last_seen_at FROM admin_sessions WHERE admin_user_id = $1",
      [admin.id],
    );
    await expect(repository.validateSession(created.token)).resolves.toMatchObject({
      admin: { id: admin.id },
    });
    const throttled = await pool.query<{ xmin: string; last_seen_at: Date }>(
      "SELECT xmin::text, last_seen_at FROM admin_sessions WHERE admin_user_id = $1",
      [admin.id],
    );
    expect(throttled.rows[0]).toEqual(original.rows[0]);

    await pool.query(
      "UPDATE admin_sessions SET last_seen_at = clock_timestamp() - interval '6 minutes' WHERE admin_user_id = $1",
      [admin.id],
    );
    const stale = await pool.query<{ xmin: string; last_seen_at: Date }>(
      "SELECT xmin::text, last_seen_at FROM admin_sessions WHERE admin_user_id = $1",
      [admin.id],
    );
    const validated = await repository.validateSession(created.token);
    const refreshed = await pool.query<{ xmin: string; last_seen_at: Date }>(
      "SELECT xmin::text, last_seen_at FROM admin_sessions WHERE admin_user_id = $1",
      [admin.id],
    );
    expect(refreshed.rows[0]!.xmin).not.toBe(stale.rows[0]!.xmin);
    expect(refreshed.rows[0]!.last_seen_at.getTime()).toBeGreaterThan(
      stale.rows[0]!.last_seen_at.getTime(),
    );
    expect(validated?.lastSeenAt).toEqual(refreshed.rows[0]!.last_seen_at);
  });

  it("deletes the session on sign-out", async () => {
    const admin = await insertAdmin();
    const session = (await repository.createSession(admin.id, admin.passwordHash, null))!;
    await signOut(repository, session.token);
    await expect(repository.validateSession(session.token)).resolves.toBeNull();
  });

  it("runs the supplied verifier for inactive users and returns the generic error", async () => {
    const admin = await insertAdmin({ active: false });
    const verifier = vi.fn().mockResolvedValue(false);
    const result = await signIn(
      { email: admin.email, password: "attempt", clientIp: randomUUID(), rawClientIp: null },
      {
        repository,
        consumeRateLimit: (input) => consumeWithPool(input, pool),
        passwordVerifier: verifier,
        dummyPasswordHash: DUMMY_PASSWORD_HASH,
      },
    );
    expect(result).toEqual({ ok: false, error: "INVALID_CREDENTIALS" });
    expect(verifier).toHaveBeenCalledWith("attempt", DUMMY_PASSWORD_HASH);
  });
});
