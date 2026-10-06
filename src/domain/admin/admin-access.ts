export const adminRoles = ["SUPER_ADMIN", "ADMIN"] as const;

export type AdminRole = (typeof adminRoles)[number];

export interface AdminAccess {
  role: AdminRole;
  isActive: boolean;
}

export type AdminAccessViolation = "SELF_ACTION" | "LAST_SUPER_ADMIN";

export function canManageAdmins(role: AdminRole): boolean {
  return role === "SUPER_ADMIN";
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
