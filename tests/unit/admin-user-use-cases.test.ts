import { describe, expect, it, vi } from "vitest";

import type { AdminUserRepository } from "@/application/admin-users/admin-user-repository";
import {
  adminPasswordChangeRateLimit,
  adminUserManagementRateLimit,
  changeOwnPassword,
  createAdminUser,
  deactivateAdminUser,
  resetAdminPassword,
  revokeAdminSessions,
  type AdminUserDependencies,
} from "@/application/admin-users/admin-user-use-cases";

const actor = { id: "actor-id" };
const targetId = "target-id";

function repository(overrides: Partial<AdminUserRepository> = {}): AdminUserRepository {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn().mockResolvedValue({ ok: true, value: {} }),
    update: vi.fn(),
    deactivate: vi.fn().mockResolvedValue({ ok: true, value: { revokedSessions: 0 } }),
    reactivate: vi.fn(),
    resetPassword: vi.fn().mockResolvedValue({ ok: true, value: { revokedSessions: 0 } }),
    revokeSessions: vi.fn().mockResolvedValue({ ok: true, value: { revokedSessions: 0 } }),
    findActivePasswordHash: vi.fn().mockResolvedValue("hash:clave-actual-123"),
    changeOwnPassword: vi.fn().mockResolvedValue({ ok: true, value: { revokedSessions: 2 } }),
    ...overrides,
  };
}

function dependencies(
  repo: AdminUserRepository,
  allowed = true,
): AdminUserDependencies & { consumeRateLimit: ReturnType<typeof vi.fn> } {
  return {
    repository: repo,
    consumeRateLimit: vi.fn().mockResolvedValue({ allowed, retryAfterSeconds: allowed ? 0 : 60 }),
    hashPassword: vi.fn(async (password: string) => `hash:${password}`),
    verifyPassword: vi.fn(
      async (password: string, encoded: string) => encoded === `hash:${password}`,
    ),
  };
}

describe("admin user use cases", () => {
  it("creates admins with a normalized email and only the password hash", async () => {
    const repo = repository();
    const deps = dependencies(repo);
    await createAdminUser(deps, actor, {
      email: "  Nuevo@Example.COM ",
      displayName: " Nuevo ",
      role: "ADMIN",
      password: "clave-nueva-123",
    });

    expect(deps.consumeRateLimit).toHaveBeenCalledWith({
      ...adminUserManagementRateLimit,
      subject: actor.id,
    });
    expect(repo.create).toHaveBeenCalledWith(actor.id, {
      email: "Nuevo@Example.COM",
      emailNormalized: "nuevo@example.com",
      displayName: "Nuevo",
      role: "ADMIN",
      passwordHash: "hash:clave-nueva-123",
    });
  });

  it("stops management mutations when the actor is rate limited", async () => {
    const repo = repository();
    const result = await createAdminUser(dependencies(repo, false), actor, {
      email: "a@example.com",
      displayName: "A",
      role: "ADMIN",
      password: "clave-nueva-123",
    });

    expect(result).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it.each([
    ["deactivate", (deps: AdminUserDependencies) => deactivateAdminUser(deps, actor, actor.id)],
    [
      "reset the password of",
      (deps: AdminUserDependencies) =>
        resetAdminPassword(deps, actor, { id: actor.id, password: "clave-nueva-123" }),
    ],
    [
      "revoke the sessions of",
      (deps: AdminUserDependencies) => revokeAdminSessions(deps, actor, actor.id),
    ],
  ])("refuses to %s the actor's own account", async (_case, run) => {
    const repo = repository();
    const deps = dependencies(repo);

    await expect(run(deps)).resolves.toEqual({ ok: false, error: "SELF_ACTION" });
    expect(deps.consumeRateLimit).not.toHaveBeenCalled();
    expect(repo.deactivate).not.toHaveBeenCalled();
    expect(repo.resetPassword).not.toHaveBeenCalled();
    expect(repo.revokeSessions).not.toHaveBeenCalled();
  });

  it("hashes the new password when resetting another admin", async () => {
    const repo = repository();
    await resetAdminPassword(dependencies(repo), actor, {
      id: targetId,
      password: "clave-nueva-123",
    });
    expect(repo.resetPassword).toHaveBeenCalledWith(actor.id, targetId, "hash:clave-nueva-123");
  });
});

describe("changeOwnPassword", () => {
  const sessionActor = { adminId: "admin-id", sessionId: "session-id" };

  it("verifies the current password and keeps the current session", async () => {
    const repo = repository();
    const deps = dependencies(repo);
    const result = await changeOwnPassword(deps, sessionActor, {
      currentPassword: "clave-actual-123",
      newPassword: "clave-nueva-123",
    });

    expect(result).toEqual({ ok: true, value: { revokedSessions: 2 } });
    expect(deps.consumeRateLimit).toHaveBeenCalledWith({
      ...adminPasswordChangeRateLimit,
      subject: sessionActor.adminId,
    });
    expect(repo.changeOwnPassword).toHaveBeenCalledWith(
      "admin-id",
      "session-id",
      "hash:clave-actual-123",
      "hash:clave-nueva-123",
    );
  });

  it("rejects a wrong current password", async () => {
    const repo = repository();
    const result = await changeOwnPassword(dependencies(repo), sessionActor, {
      currentPassword: "otra-clave-123",
      newPassword: "clave-nueva-123",
    });
    expect(result).toEqual({ ok: false, error: "INVALID_CURRENT_PASSWORD" });
    expect(repo.changeOwnPassword).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    const result = await changeOwnPassword(dependencies(repository()), sessionActor, {
      currentPassword: "clave-actual-123",
      newPassword: "clave-actual-123",
    });
    expect(result).toEqual({ ok: false, error: "SAME_PASSWORD" });
  });

  it("rejects inactive admins and rate-limited attempts", async () => {
    const inactive = repository({ findActivePasswordHash: vi.fn().mockResolvedValue(null) });
    await expect(
      changeOwnPassword(dependencies(inactive), sessionActor, {
        currentPassword: "clave-actual-123",
        newPassword: "clave-nueva-123",
      }),
    ).resolves.toEqual({ ok: false, error: "INVALID_CURRENT_PASSWORD" });

    const limited = repository();
    await expect(
      changeOwnPassword(dependencies(limited, false), sessionActor, {
        currentPassword: "clave-actual-123",
        newPassword: "clave-nueva-123",
      }),
    ).resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(limited.findActivePasswordHash).not.toHaveBeenCalled();
  });
});
