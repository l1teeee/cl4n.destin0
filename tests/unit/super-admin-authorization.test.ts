import { describe, expect, it, vi } from "vitest";

import type { AdminAuthRepository } from "@/application/auth/admin-auth-repository";
import type { AdminRole, AdminSession } from "@/application/auth/types";
import { authorizeSuperAdminSession } from "@/infrastructure/auth/require-admin";
import { adminRoleLabel, adminStatusLabel } from "@/ui/admin/view-model";

function session(role: AdminRole): AdminSession {
  const now = new Date("2026-10-05T12:00:00Z");
  return {
    id: "session-id",
    admin: { id: "admin-id", email: "admin@example.com", displayName: "Admin", role },
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now,
    databaseTime: now,
  };
}

function repository(result: AdminSession | null): AdminAuthRepository {
  return {
    findByEmail: vi.fn(),
    createSession: vi.fn(),
    validateSession: vi.fn().mockResolvedValue(result),
    deleteSession: vi.fn(),
  };
}

describe("authorizeSuperAdminSession", () => {
  it("rejects missing and invalid sessions as unauthorized", async () => {
    await expect(authorizeSuperAdminSession(undefined, repository(null))).resolves.toEqual({
      authorized: false,
      error: "UNAUTHORIZED",
    });
    await expect(authorizeSuperAdminSession("token", repository(null))).resolves.toEqual({
      authorized: false,
      error: "UNAUTHORIZED",
    });
  });

  it("forbids regular admins", async () => {
    await expect(
      authorizeSuperAdminSession("token", repository(session("ADMIN"))),
    ).resolves.toEqual({
      authorized: false,
      error: "FORBIDDEN",
    });
  });

  it("authorizes super admins", async () => {
    const superAdmin = session("SUPER_ADMIN");
    await expect(authorizeSuperAdminSession("token", repository(superAdmin))).resolves.toEqual({
      authorized: true,
      session: superAdmin,
      token: "token",
    });
  });
});

describe("admin user labels", () => {
  it("labels roles and status in Spanish", () => {
    expect(adminRoleLabel("SUPER_ADMIN")).toBe("Superadministrador");
    expect(adminRoleLabel("ADMIN")).toBe("Administrador");
    expect(adminStatusLabel(true)).toBe("Activo");
    expect(adminStatusLabel(false)).toBe("Inactivo");
  });
});
