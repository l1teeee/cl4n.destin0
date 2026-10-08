import { describe, expect, it, vi } from "vitest";

import type { AdminUserRepository } from "@/application/admin-users/admin-user-repository";
import {
  adminPasswordChangeRateLimit,
  adminUserDeletionCodeRateLimit,
  adminUserDeletionConfirmRateLimit,
  adminUserManagementRateLimit,
  changeOwnPassword,
  confirmAdminUserDeletion,
  createAdminUser,
  deactivateAdminUser,
  resetAdminPassword,
  requestAdminUserDeletionCode,
  revokeAdminSessions,
  type AdminUserDependencies,
} from "@/application/admin-users/admin-user-use-cases";

const actor = {
  id: "actor-id",
  email: "actor@example.com",
  displayName: "Actor",
  role: "SUPER_ADMIN" as const,
};
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
    createDeletionCode: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        codeId: "code-id",
        target: { displayName: "Target", email: "target@example.com" },
        expiresInMinutes: 10,
      },
    }),
    invalidateCode: vi.fn().mockResolvedValue(undefined),
    deleteWithCode: vi.fn().mockResolvedValue({ ok: true, value: { revokedSessions: 1 } }),
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
    notifications: {
      sendAdminAdded: vi.fn().mockResolvedValue(undefined),
      sendDeletionCode: vi.fn().mockResolvedValue(undefined),
    },
    generateDeletionCode: vi.fn(() => "012345"),
    hashDeletionCode: vi.fn(
      (actorId: string, target: string, code: string) => `hash:${actorId}:${target}:${code}`,
    ),
    logError: vi.fn(),
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

  it("reports admin-added notification success and failure without rolling back creation", async () => {
    const created = {
      id: targetId,
      email: "target@example.com",
      displayName: "Target",
      role: "ADMIN" as const,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignInAt: null,
      activeSessionCount: 0,
    };
    const repo = repository({ create: vi.fn().mockResolvedValue({ ok: true, value: created }) });
    const sent = dependencies(repo);
    const input = {
      email: created.email,
      displayName: created.displayName,
      role: created.role,
      password: "clave-nueva-123",
    };

    await expect(createAdminUser(sent, actor, input)).resolves.toMatchObject({
      ok: true,
      value: { notification: "SENT" },
    });

    const failed = dependencies(repo);
    vi.mocked(failed.notifications.sendAdminAdded).mockRejectedValue(new Error("delivery"));
    await expect(createAdminUser(failed, actor, input)).resolves.toMatchObject({
      ok: true,
      value: { notification: "FAILED" },
    });
    expect(failed.logError).toHaveBeenCalledWith("admin_added_email_failed");
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

describe("admin user deletion", () => {
  it.each([
    [
      "request",
      (deps: AdminUserDependencies) => requestAdminUserDeletionCode(deps, actor, actor.id),
    ],
    [
      "confirm",
      (deps: AdminUserDependencies) =>
        confirmAdminUserDeletion(deps, actor, { targetId: actor.id, code: "012345" }),
    ],
  ])("rejects self-action before rate limiting for %s", async (_name, run) => {
    const repo = repository();
    const deps = dependencies(repo);
    await expect(run(deps)).resolves.toEqual({ ok: false, error: "SELF_ACTION" });
    expect(deps.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("uses the dedicated rate limits for request and confirm", async () => {
    const repo = repository();
    const requestDeps = dependencies(repo, false);
    await expect(requestAdminUserDeletionCode(requestDeps, actor, targetId)).resolves.toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });
    expect(requestDeps.consumeRateLimit).toHaveBeenCalledWith({
      ...adminUserDeletionCodeRateLimit,
      subject: actor.id,
    });

    const confirmDeps = dependencies(repo, false);
    await expect(
      confirmAdminUserDeletion(confirmDeps, actor, { targetId, code: "012345" }),
    ).resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(confirmDeps.consumeRateLimit).toHaveBeenCalledWith({
      ...adminUserDeletionConfirmRateLimit,
      subject: actor.id,
    });
  });

  it("sends only the deletion code hash to the repository", async () => {
    const repo = repository();
    const deps = dependencies(repo);
    await requestAdminUserDeletionCode(deps, actor, targetId);

    expect(repo.createDeletionCode).toHaveBeenCalledWith(
      actor.id,
      targetId,
      `hash:${actor.id}:${targetId}:012345`,
    );
    expect(JSON.stringify(vi.mocked(repo.createDeletionCode).mock.calls)).not.toContain('"012345"');
  });

  it("invalidates a code when its email cannot be delivered", async () => {
    const repo = repository();
    const deps = dependencies(repo);
    vi.mocked(deps.notifications.sendDeletionCode).mockRejectedValue(new Error("delivery"));

    await expect(requestAdminUserDeletionCode(deps, actor, targetId)).resolves.toEqual({
      ok: false,
      error: "EMAIL_DELIVERY_FAILED",
    });
    expect(repo.invalidateCode).toHaveBeenCalledWith("code-id");
    expect(deps.logError).toHaveBeenCalledWith("admin_deletion_code_email_failed");
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
