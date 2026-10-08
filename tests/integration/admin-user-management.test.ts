import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  changeOwnPassword,
  confirmAdminUserDeletion,
  createAdminUser,
  deactivateAdminUser,
  listAdminUsers,
  reactivateAdminUser,
  resetAdminPassword,
  requestAdminUserDeletionCode,
  revokeAdminSessions,
  updateAdminUser,
  type AdminUserDependencies,
} from "@/application/admin-users/admin-user-use-cases";
import { signIn } from "@/application/auth/sign-in";
import type { AdminRole } from "@/application/auth/types";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/infrastructure/auth/password";
import { authorizeSuperAdminSession } from "@/infrastructure/auth/require-admin";
import { PostgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { hashAdminUserDeletionCode } from "@/infrastructure/crypto/admin-user-deletion-code";
import { PostgresAdminUserRepository } from "@/infrastructure/db/repositories/postgres-admin-user-repository";
import { consumeWithPool } from "@/infrastructure/rate-limit/postgres-rate-limiter";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

const initialPassword = "clave-inicial-123";
let initialHash: string;
let pool: Pool;
let users: PostgresAdminUserRepository;
let auth: PostgresAdminAuthRepository;
let dependencies: AdminUserDependencies;
let nextDeletionCode = "123456";
let sentDeletionCodes: string[] = [];

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
  users = new PostgresAdminUserRepository(pool);
  auth = new PostgresAdminAuthRepository(pool);
  initialHash = await hashPassword(initialPassword);
  dependencies = {
    repository: users,
    consumeRateLimit: (input) => consumeWithPool(input, pool),
    hashPassword,
    verifyPassword,
    notifications: {
      sendDeletionCode: async (input) => {
        sentDeletionCodes.push(input.code);
      },
    },
    generateDeletionCode: () => nextDeletionCode,
    hashDeletionCode: hashAdminUserDeletionCode,
    logError: () => undefined,
  };
});

beforeEach(async () => {
  await pool.query("TRUNCATE rate_limit_counters");
  nextDeletionCode = "123456";
  sentDeletionCodes = [];
});

afterAll(async () => {
  await pool.end();
});

async function insertAdmin(role: AdminRole, active = true) {
  const email = `${randomUUID()}@example.com`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role, is_active)
     VALUES ($1, $1, $2, 'Admin de prueba', $3, $4)
     RETURNING id`,
    [email, initialHash, role, active],
  );
  return { id: result.rows[0]!.id, email, displayName: "Admin de prueba", role };
}

function realSignIn(email: string, password: string) {
  return signIn(
    { email, password, clientIp: randomUUID(), rawClientIp: null },
    {
      repository: auth,
      consumeRateLimit: (input) => consumeWithPool(input, pool),
      passwordVerifier: verifyPassword,
      dummyPasswordHash: DUMMY_PASSWORD_HASH,
    },
  );
}

async function auditRows(entityId: string) {
  const result = await pool.query(
    `SELECT actor_admin_id, action, entity_type, metadata
       FROM audit_logs
      WHERE entity_id = $1 AND action <> 'ADMIN_SIGNED_IN'
      ORDER BY id`,
    [entityId],
  );
  return result.rows;
}

describe("admin user creation", () => {
  it("creates an admin with a hashed password and audits without secrets", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const email = `Nuevo.${randomUUID()}@Example.com`;
    const result = await createAdminUser(dependencies, actor, {
      email,
      displayName: "Nuevo",
      role: "ADMIN",
      password: "clave-nueva-123",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      email,
      displayName: "Nuevo",
      role: "ADMIN",
      isActive: true,
      activeSessionCount: 0,
      lastSignInAt: null,
    });
    const stored = await pool.query<{ email_normalized: string; password_hash: string }>(
      "SELECT email_normalized, password_hash FROM admin_users WHERE id = $1",
      [result.value.id],
    );
    expect(stored.rows[0]!.email_normalized).toBe(email.toLowerCase());
    expect(stored.rows[0]!.password_hash).not.toContain("clave-nueva-123");
    await expect(verifyPassword("clave-nueva-123", stored.rows[0]!.password_hash)).resolves.toBe(
      true,
    );

    const audit = await auditRows(result.value.id);
    expect(audit).toEqual([
      {
        actor_admin_id: actor.id,
        action: "ADMIN_USER_CREATED",
        entity_type: "ADMIN_USER",
        metadata: { role: "ADMIN" },
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain(stored.rows[0]!.password_hash);

    await expect(realSignIn(email, "clave-nueva-123")).resolves.toMatchObject({
      ok: true,
      admin: { role: "ADMIN" },
    });
  });

  it("rejects duplicate emails regardless of case", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const email = `dup.${randomUUID()}@example.com`;
    const input = { displayName: "Dup", role: "ADMIN" as const, password: "clave-nueva-123" };

    await expect(createAdminUser(dependencies, actor, { ...input, email })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      createAdminUser(dependencies, actor, { ...input, email: email.toUpperCase() }),
    ).resolves.toEqual({ ok: false, error: "EMAIL_TAKEN" });
  });

  it("forbids actors that are not active super admins", async () => {
    const admin = await insertAdmin("ADMIN");
    const inactiveSuperAdmin = await insertAdmin("SUPER_ADMIN", false);
    const email = `forbidden.${randomUUID()}@example.com`;

    for (const actor of [admin, inactiveSuperAdmin]) {
      await expect(
        createAdminUser(dependencies, actor, {
          email,
          displayName: "No",
          role: "SUPER_ADMIN",
          password: "clave-nueva-123",
        }),
      ).resolves.toEqual({ ok: false, error: "FORBIDDEN" });
    }
    const count = await pool.query("SELECT 1 FROM admin_users WHERE email_normalized = $1", [
      email,
    ]);
    expect(count.rowCount).toBe(0);
  });
});

describe("admin user updates", () => {
  it("changes name and role and audits only real changes", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");

    const promoted = await updateAdminUser(dependencies, actor, {
      id: target.id,
      displayName: "  Promovido ",
      role: "SUPER_ADMIN",
      expectedRole: "ADMIN",
    });
    expect(promoted).toMatchObject({
      ok: true,
      value: { displayName: "Promovido", role: "SUPER_ADMIN" },
    });
    await updateAdminUser(dependencies, actor, {
      id: target.id,
      displayName: "Promovido",
      role: "SUPER_ADMIN",
      expectedRole: "SUPER_ADMIN",
    });

    expect(await auditRows(target.id)).toEqual([
      {
        actor_admin_id: actor.id,
        action: "ADMIN_USER_UPDATED",
        entity_type: "ADMIN_USER",
        metadata: { role: { from: "ADMIN", to: "SUPER_ADMIN" }, displayNameChanged: true },
      },
    ]);
  });

  it("rejects a stale role without changing the user or audit log", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("SUPER_ADMIN");

    await expect(
      updateAdminUser(dependencies, actor, {
        id: target.id,
        displayName: "Admin de prueba",
        role: "ADMIN",
        expectedRole: "SUPER_ADMIN",
      }),
    ).resolves.toMatchObject({ ok: true });
    const auditBefore = await auditRows(target.id);

    await expect(
      updateAdminUser(dependencies, actor, {
        id: target.id,
        displayName: "Nombre obsoleto",
        role: "SUPER_ADMIN",
        expectedRole: "SUPER_ADMIN",
      }),
    ).resolves.toEqual({ ok: false, error: "ROLE_CHANGED" });

    await expect(users.findById(target.id)).resolves.toMatchObject({
      displayName: "Admin de prueba",
      role: "ADMIN",
    });
    await expect(auditRows(target.id)).resolves.toEqual(auditBefore);
  });

  it("blocks self-demotion and self-deactivation but allows renaming yourself", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");

    await expect(
      updateAdminUser(dependencies, actor, {
        id: actor.id,
        displayName: "Yo",
        role: "ADMIN",
        expectedRole: "SUPER_ADMIN",
      }),
    ).resolves.toEqual({ ok: false, error: "SELF_ACTION" });
    await expect(users.deactivate(actor.id, actor.id)).resolves.toEqual({
      ok: false,
      error: "SELF_ACTION",
    });
    await expect(
      updateAdminUser(dependencies, actor, {
        id: actor.id,
        displayName: "Nuevo nombre",
        role: "SUPER_ADMIN",
        expectedRole: "SUPER_ADMIN",
      }),
    ).resolves.toMatchObject({ ok: true, value: { displayName: "Nuevo nombre" } });
  });

  it("returns NOT_FOUND for unknown admins", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const unknown = randomUUID();

    await expect(
      updateAdminUser(dependencies, actor, {
        id: unknown,
        displayName: "X",
        role: "ADMIN",
        expectedRole: "ADMIN",
      }),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    await expect(deactivateAdminUser(dependencies, actor, unknown)).resolves.toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    await expect(reactivateAdminUser(dependencies, actor, unknown)).resolves.toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    await expect(revokeAdminSessions(dependencies, actor, unknown)).resolves.toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("removes super-admin access from a demoted admin on the next request", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("SUPER_ADMIN");
    const session = (await auth.createSession(target.id, initialHash, null))!;

    await expect(authorizeSuperAdminSession(session.token, auth)).resolves.toMatchObject({
      authorized: true,
    });
    await updateAdminUser(dependencies, actor, {
      id: target.id,
      displayName: "Admin de prueba",
      role: "ADMIN",
      expectedRole: "SUPER_ADMIN",
    });

    await expect(authorizeSuperAdminSession(session.token, auth)).resolves.toEqual({
      authorized: false,
      error: "FORBIDDEN",
    });
    await expect(
      createAdminUser(dependencies, target, {
        email: `${randomUUID()}@example.com`,
        displayName: "X",
        role: "ADMIN",
        password: "clave-nueva-123",
      }),
    ).resolves.toEqual({ ok: false, error: "FORBIDDEN" });
  });
});

describe("admin access lifecycle", () => {
  it("deactivation revokes sessions and blocks sign-in until reactivated", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");
    const first = (await auth.createSession(target.id, initialHash, null))!;
    const second = (await auth.createSession(target.id, initialHash, null))!;

    await expect(deactivateAdminUser(dependencies, actor, target.id)).resolves.toEqual({
      ok: true,
      value: { revokedSessions: 2 },
    });
    await expect(auth.validateSession(first.token)).resolves.toBeNull();
    await expect(auth.validateSession(second.token)).resolves.toBeNull();
    await expect(realSignIn(target.email, initialPassword)).resolves.toEqual({
      ok: false,
      error: "INVALID_CREDENTIALS",
    });
    await expect(deactivateAdminUser(dependencies, actor, target.id)).resolves.toEqual({
      ok: false,
      error: "ALREADY_INACTIVE",
    });

    await expect(reactivateAdminUser(dependencies, actor, target.id)).resolves.toMatchObject({
      ok: true,
      value: { isActive: true },
    });
    await expect(reactivateAdminUser(dependencies, actor, target.id)).resolves.toEqual({
      ok: false,
      error: "ALREADY_ACTIVE",
    });
    await expect(realSignIn(target.email, initialPassword)).resolves.toMatchObject({ ok: true });

    expect((await auditRows(target.id)).map((row) => [row.action, row.metadata])).toEqual([
      ["ADMIN_USER_DEACTIVATED", { revokedSessions: 2 }],
      ["ADMIN_USER_REACTIVATED", {}],
    ]);
  });

  it("password reset replaces the hash and closes the target's sessions", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");
    const session = (await auth.createSession(target.id, initialHash, null))!;

    await expect(
      resetAdminPassword(dependencies, actor, { id: target.id, password: "clave-restablecida-1" }),
    ).resolves.toEqual({ ok: true, value: { revokedSessions: 1 } });
    await expect(auth.validateSession(session.token)).resolves.toBeNull();
    await expect(realSignIn(target.email, initialPassword)).resolves.toMatchObject({ ok: false });
    await expect(realSignIn(target.email, "clave-restablecida-1")).resolves.toMatchObject({
      ok: true,
    });

    const audit = await auditRows(target.id);
    expect(audit.map((row) => [row.action, row.metadata])).toEqual([
      ["ADMIN_PASSWORD_RESET", { revokedSessions: 1 }],
    ]);
    expect(JSON.stringify(audit)).not.toContain("clave-restablecida-1");
  });

  it("revokes every session of another admin", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");
    const first = (await auth.createSession(target.id, initialHash, null))!;
    const second = (await auth.createSession(target.id, initialHash, null))!;

    await expect(revokeAdminSessions(dependencies, actor, target.id)).resolves.toEqual({
      ok: true,
      value: { revokedSessions: 2 },
    });
    await expect(auth.validateSession(first.token)).resolves.toBeNull();
    await expect(auth.validateSession(second.token)).resolves.toBeNull();
    await expect(users.revokeSessions(actor.id, actor.id)).resolves.toEqual({
      ok: false,
      error: "SELF_ACTION",
    });
  });

  it("lists admins with role, status and active session counts", async () => {
    const target = await insertAdmin("ADMIN");
    await auth.createSession(target.id, initialHash, null);
    const listed = (await listAdminUsers(users)).find((admin) => admin.id === target.id);

    expect(listed).toMatchObject({
      email: target.email,
      role: "ADMIN",
      isActive: true,
      activeSessionCount: 1,
    });
  });
});

describe("own password change", () => {
  it("keeps the current session, closes the others and audits", async () => {
    const admin = await insertAdmin("ADMIN");
    const current = (await auth.createSession(admin.id, initialHash, null))!;
    const other = (await auth.createSession(admin.id, initialHash, null))!;
    const currentSession = await auth.validateSession(current.token);

    await expect(
      changeOwnPassword(
        dependencies,
        { adminId: admin.id, sessionId: currentSession!.id },
        { currentPassword: initialPassword, newPassword: "otra-clave-nueva-1" },
      ),
    ).resolves.toEqual({ ok: true, value: { revokedSessions: 1 } });

    await expect(auth.validateSession(current.token)).resolves.not.toBeNull();
    await expect(auth.validateSession(other.token)).resolves.toBeNull();
    await expect(realSignIn(admin.email, "otra-clave-nueva-1")).resolves.toMatchObject({
      ok: true,
    });
    expect(await auditRows(admin.id)).toEqual([
      {
        actor_admin_id: admin.id,
        action: "ADMIN_PASSWORD_CHANGED",
        entity_type: "ADMIN_USER",
        metadata: { revokedSessions: 1 },
      },
    ]);
  });

  it("rate-limits attempts after five tries", async () => {
    const admin = await insertAdmin("ADMIN");
    const session = (await auth.createSession(admin.id, initialHash, null))!;
    const sessionId = (await auth.validateSession(session.token))!.id;
    const outcomes = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      outcomes.push(
        await changeOwnPassword(
          dependencies,
          { adminId: admin.id, sessionId },
          { currentPassword: "clave-equivocada-1", newPassword: "otra-clave-nueva-1" },
        ),
      );
    }

    expect(outcomes.slice(0, 5)).toEqual(
      Array.from({ length: 5 }, () => ({ ok: false, error: "INVALID_CURRENT_PASSWORD" })),
    );
    expect(outcomes[5]).toEqual({ ok: false, error: "RATE_LIMITED" });
  });
});

describe("admin deletion", () => {
  it("soft-deletes the target, revokes access and audits without the code or email", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");
    await auth.createSession(target.id, initialHash, null);
    await auth.createSession(target.id, initialHash, null);

    await expect(
      requestAdminUserDeletionCode(dependencies, actor, target.id),
    ).resolves.toMatchObject({ ok: true, value: { expiresInMinutes: 10 } });
    expect(sentDeletionCodes).toEqual(["123456"]);
    await expect(
      confirmAdminUserDeletion(dependencies, actor, { targetId: target.id, code: "123456" }),
    ).resolves.toEqual({ ok: true, value: { revokedSessions: 2 } });

    const stored = await pool.query<{ deleted_at: Date; is_active: boolean }>(
      "SELECT deleted_at, is_active FROM admin_users WHERE id = $1",
      [target.id],
    );
    expect(stored.rows[0]!.deleted_at).toBeInstanceOf(Date);
    expect(stored.rows[0]!.is_active).toBe(false);
    await expect(users.findById(target.id)).resolves.toBeNull();
    expect((await listAdminUsers(users)).some((user) => user.id === target.id)).toBe(false);
    await expect(realSignIn(target.email, initialPassword)).resolves.toEqual({
      ok: false,
      error: "INVALID_CREDENTIALS",
    });
    const sessions = await pool.query("SELECT 1 FROM admin_sessions WHERE admin_user_id = $1", [
      target.id,
    ]);
    expect(sessions.rowCount).toBe(0);

    const audit = await auditRows(target.id);
    expect(audit.map((row) => [row.action, row.metadata])).toEqual([
      ["ADMIN_USER_DELETION_REQUESTED", {}],
      ["ADMIN_USER_DELETED", { revokedSessions: 2 }],
    ]);
    expect(JSON.stringify(audit)).not.toContain("123456");
    expect(JSON.stringify(audit)).not.toContain(target.email);
  });

  it("invalidates a code on the fifth wrong attempt", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");
    await requestAdminUserDeletionCode(dependencies, actor, target.id);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        confirmAdminUserDeletion(dependencies, actor, { targetId: target.id, code: "000000" }),
      ).resolves.toEqual({ ok: false, error: "CODE_INVALID" });
    }
    await expect(
      confirmAdminUserDeletion(dependencies, actor, { targetId: target.id, code: "000000" }),
    ).resolves.toEqual({ ok: false, error: "TOO_MANY_ATTEMPTS" });
    await expect(
      confirmAdminUserDeletion(dependencies, actor, { targetId: target.id, code: "123456" }),
    ).resolves.toEqual({ ok: false, error: "CODE_INVALID" });

    const code = await pool.query<{ attempts: number; invalidated_at: Date }>(
      "SELECT attempts, invalidated_at FROM admin_action_codes WHERE target_admin_id = $1",
      [target.id],
    );
    expect(code.rows[0]!.attempts).toBe(5);
    expect(code.rows[0]!.invalidated_at).toBeInstanceOf(Date);
  });

  it("expires codes by the database clock", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");
    await requestAdminUserDeletionCode(dependencies, actor, target.id);
    await pool.query(
      "UPDATE admin_action_codes SET expires_at = clock_timestamp() - interval '1 second' WHERE target_admin_id = $1",
      [target.id],
    );

    await expect(
      confirmAdminUserDeletion(dependencies, actor, { targetId: target.id, code: "123456" }),
    ).resolves.toEqual({ ok: false, error: "CODE_EXPIRED" });
  });

  it("prevents replay and invalidates a previous code on a new request", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const firstTarget = await insertAdmin("ADMIN");
    await requestAdminUserDeletionCode(dependencies, actor, firstTarget.id);
    await confirmAdminUserDeletion(dependencies, actor, {
      targetId: firstTarget.id,
      code: "123456",
    });
    await expect(
      confirmAdminUserDeletion(dependencies, actor, {
        targetId: firstTarget.id,
        code: "123456",
      }),
    ).resolves.toEqual({ ok: false, error: "CODE_INVALID" });

    const secondTarget = await insertAdmin("ADMIN");
    await requestAdminUserDeletionCode(dependencies, actor, secondTarget.id);
    nextDeletionCode = "654321";
    await requestAdminUserDeletionCode(dependencies, actor, secondTarget.id);
    await expect(
      confirmAdminUserDeletion(dependencies, actor, {
        targetId: secondTarget.id,
        code: "123456",
      }),
    ).resolves.toEqual({ ok: false, error: "CODE_INVALID" });
    await expect(
      confirmAdminUserDeletion(dependencies, actor, {
        targetId: secondTarget.id,
        code: "654321",
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("forbids regular-admin actors at the repository boundary", async () => {
    const actor = await insertAdmin("ADMIN");
    const target = await insertAdmin("ADMIN");
    const hash = hashAdminUserDeletionCode(actor.id, target.id, "123456");

    await expect(users.createDeletionCode(actor.id, target.id, hash)).resolves.toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    await expect(users.deleteWithCode(actor.id, target.id, hash)).resolves.toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
  });

  it("forbids deletion by a non-super-admin actor", async () => {
    await pool.query("UPDATE admin_users SET is_active = false WHERE role = 'SUPER_ADMIN'");
    const actor = await insertAdmin("ADMIN");
    const target = await insertAdmin("SUPER_ADMIN");
    const hash = hashAdminUserDeletionCode(actor.id, target.id, "123456");
    await pool.query(
      `INSERT INTO admin_action_codes (
         purpose, actor_admin_id, target_admin_id, code_hash, expires_at
       ) VALUES ('ADMIN_USER_DELETE', $1, $2, $3, clock_timestamp() + interval '10 minutes')`,
      [actor.id, target.id, hash],
    );

    await expect(users.deleteWithCode(actor.id, target.id, hash)).resolves.toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
    await expect(users.findById(target.id)).resolves.toMatchObject({
      role: "SUPER_ADMIN",
      isActive: true,
    });
  });

  it("allows a deleted email to be recreated and keeps deletion terminal", async () => {
    const actor = await insertAdmin("SUPER_ADMIN");
    const target = await insertAdmin("ADMIN");
    await requestAdminUserDeletionCode(dependencies, actor, target.id);
    await confirmAdminUserDeletion(dependencies, actor, { targetId: target.id, code: "123456" });

    await expect(reactivateAdminUser(dependencies, actor, target.id)).resolves.toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    const recreated = await createAdminUser(dependencies, actor, {
      email: target.email,
      displayName: "Recreado",
      role: "ADMIN",
      password: "clave-recreada-123",
    });
    expect(recreated).toMatchObject({ ok: true });
    await expect(realSignIn(target.email, "clave-recreada-123")).resolves.toMatchObject({
      ok: true,
      admin: { role: "ADMIN" },
    });
  });
});
