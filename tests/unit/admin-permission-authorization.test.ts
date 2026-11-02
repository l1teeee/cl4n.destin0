import { describe, expect, it, vi } from "vitest";

import type { AdminAuthRepository } from "@/application/auth/admin-auth-repository";
import type { AdminRole, AdminSession } from "@/application/auth/types";
import { authorizePermission } from "@/infrastructure/auth/require-admin";
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

describe("authorizePermission", () => {
  it("rejects missing and invalid sessions as unauthorized", async () => {
    await expect(authorizePermission(undefined, repository(null), "users.manage")).resolves.toEqual(
      {
        authorized: false,
        error: "UNAUTHORIZED",
      },
    );
    await expect(authorizePermission("token", repository(null), "users.manage")).resolves.toEqual({
      authorized: false,
      error: "UNAUTHORIZED",
    });
  });

  it("forbids regular admins", async () => {
    await expect(
      authorizePermission("token", repository(session("ADMIN")), "users.manage"),
    ).resolves.toEqual({
      authorized: false,
      error: "FORBIDDEN",
    });
  });

  it("authorizes super admins", async () => {
    const superAdmin = session("SUPER_ADMIN");
    await expect(
      authorizePermission("token", repository(superAdmin), "users.manage"),
    ).resolves.toEqual({
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
