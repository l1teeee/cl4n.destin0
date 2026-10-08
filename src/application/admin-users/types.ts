import type { AdminRole } from "@/domain/admin/admin-access";

export type AdminUserErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "EMAIL_TAKEN"
  | "SELF_ACTION"
  | "LAST_SUPER_ADMIN"
  | "ROLE_CHANGED"
  | "ALREADY_ACTIVE"
  | "ALREADY_INACTIVE"
  | "INVALID_CURRENT_PASSWORD"
  | "SAME_PASSWORD"
  | "RATE_LIMITED";

export type AdminUserResult<T> = { ok: true; value: T } | { ok: false; error: AdminUserErrorCode };

export interface AdminUserSummary {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSignInAt: Date | null;
  activeSessionCount: number;
}

export interface SessionRevocation {
  revokedSessions: number;
}

export interface CreateAdminUserCommand {
  email: string;
  emailNormalized: string;
  displayName: string;
  role: AdminRole;
  passwordHash: string;
}

export interface UpdateAdminUserCommand {
  id: string;
  displayName: string;
  role: AdminRole;
  expectedRole: AdminRole;
}

export interface AdminActor {
  id: string;
}

export interface SessionActor {
  adminId: string;
  sessionId: string;
}
