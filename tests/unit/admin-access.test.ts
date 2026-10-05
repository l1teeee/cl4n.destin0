import { describe, expect, it } from "vitest";

import {
  canManageAdmins,
  checkAccessChange,
  isActiveSuperAdmin,
  type AdminAccess,
} from "@/domain/admin/admin-access";

const actorId = "actor-id";
const targetId = "target-id";
const activeSuperAdmin: AdminAccess = { role: "SUPER_ADMIN", isActive: true };

describe("admin access policy", () => {
  it("lets only super admins manage admins", () => {
    expect(canManageAdmins("SUPER_ADMIN")).toBe(true);
    expect(canManageAdmins("ADMIN")).toBe(false);
  });

  it("counts only active super admins", () => {
    expect(isActiveSuperAdmin(activeSuperAdmin)).toBe(true);
    expect(isActiveSuperAdmin({ role: "SUPER_ADMIN", isActive: false })).toBe(false);
    expect(isActiveSuperAdmin({ role: "ADMIN", isActive: true })).toBe(false);
  });

  it("allows edits that keep access unchanged, including on the actor's own account", () => {
    expect(
      checkAccessChange({
        actorId,
        targetId: actorId,
        current: activeSuperAdmin,
        next: activeSuperAdmin,
        activeSuperAdminIds: [actorId],
      }),
    ).toBeNull();
  });

  it.each([
    ["role", { role: "ADMIN", isActive: true }],
    ["status", { role: "SUPER_ADMIN", isActive: false }],
  ] as const)("rejects changing the actor's own %s", (_case, next) => {
    expect(
      checkAccessChange({
        actorId,
        targetId: actorId,
        current: activeSuperAdmin,
        next,
        activeSuperAdminIds: [actorId, targetId],
      }),
    ).toBe("SELF_ACTION");
  });

  it.each([
    ["demoting", { role: "ADMIN", isActive: true }],
    ["deactivating", { role: "SUPER_ADMIN", isActive: false }],
  ] as const)("rejects %s the last active super admin", (_case, next) => {
    expect(
      checkAccessChange({
        actorId,
        targetId,
        current: activeSuperAdmin,
        next,
        activeSuperAdminIds: [targetId],
      }),
    ).toBe("LAST_SUPER_ADMIN");
  });

  it("allows removing a super admin while another active super admin remains", () => {
    expect(
      checkAccessChange({
        actorId,
        targetId,
        current: activeSuperAdmin,
        next: { role: "ADMIN", isActive: true },
        activeSuperAdminIds: [actorId, targetId],
      }),
    ).toBeNull();
  });

  it("allows promotions and changes to admins or inactive accounts", () => {
    const base = { actorId, targetId, activeSuperAdminIds: [actorId] };
    expect(
      checkAccessChange({
        ...base,
        current: { role: "ADMIN", isActive: true },
        next: activeSuperAdmin,
      }),
    ).toBeNull();
    expect(
      checkAccessChange({
        ...base,
        current: { role: "ADMIN", isActive: true },
        next: { role: "ADMIN", isActive: false },
      }),
    ).toBeNull();
    expect(
      checkAccessChange({
        ...base,
        current: { role: "SUPER_ADMIN", isActive: false },
        next: { role: "ADMIN", isActive: false },
      }),
    ).toBeNull();
  });
});
