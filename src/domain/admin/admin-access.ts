export const adminRoles = ["SUPER_ADMIN", "ADMIN"] as const;

export type AdminRole = (typeof adminRoles)[number];

// Only capabilities that some role lacks. Everything else is open to every active admin.
export const adminPermissions = [
  "users.manage",
  "messages.send",
  "templates.edit",
  "instagram.connect",
] as const;

export type AdminPermission = (typeof adminPermissions)[number];

const rolePermissions: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  SUPER_ADMIN: new Set(adminPermissions),
  ADMIN: new Set(),
};

export interface AdminAccess {
  role: AdminRole;
  isActive: boolean;
}

export type AdminAccessViolation = "SELF_ACTION" | "LAST_SUPER_ADMIN";

export function hasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return rolePermissions[role].has(permission);
}

export function isActiveSuperAdmin(access: AdminAccess): boolean {
  return access.isActive && access.role === "SUPER_ADMIN";
}

export function checkAccessChange(input: {
  actorId: string;
  targetId: string;
  current: AdminAccess;
  next: AdminAccess;
  activeSuperAdminIds: readonly string[];
}): AdminAccessViolation | null {
  const accessChanges =
    input.current.role !== input.next.role || input.current.isActive !== input.next.isActive;
  if (!accessChanges) {
    return null;
  }
  if (input.actorId === input.targetId) {
    return "SELF_ACTION";
  }
  if (isActiveSuperAdmin(input.current) && !isActiveSuperAdmin(input.next)) {
    const remaining = input.activeSuperAdminIds.filter((id) => id !== input.targetId);
    if (remaining.length === 0) {
      return "LAST_SUPER_ADMIN";
    }
  }
  return null;
}
