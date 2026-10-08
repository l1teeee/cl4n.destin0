import type { AdminRole } from "@/domain/admin/admin-access";
import type { AuthenticatedAdmin } from "@/application/auth/types";

import type { AdminUserNotifications } from "./admin-user-notifications";
import type { AdminUserRepository } from "./admin-user-repository";
import type {
  AdminActor,
  AdminDeletionCodeRecord,
  AdminUserErrorCode,
  AdminUserResult,
  AdminUserSummary,
  SessionActor,
  SessionRevocation,
} from "./types";

interface RateLimitInput {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export const adminUserManagementRateLimit = {
  scope: "admin-user-management:admin",
  limit: 30,
  windowSeconds: 900,
};

export const adminPasswordChangeRateLimit = {
  scope: "admin-password-change:admin",
  limit: 5,
  windowSeconds: 900,
};

export const adminUserDeletionCodeRateLimit = {
  scope: "admin-user-deletion-code:admin",
  limit: 5,
  windowSeconds: 900,
};

export const adminUserDeletionConfirmRateLimit = {
  scope: "admin-user-deletion-confirm:admin",
  limit: 10,
  windowSeconds: 900,
};

export interface AdminUserDependencies {
  repository: AdminUserRepository;
  consumeRateLimit: (input: RateLimitInput) => Promise<RateLimitResult>;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, encoded: string) => Promise<boolean>;
  notifications: AdminUserNotifications;
  generateDeletionCode: () => string;
  hashDeletionCode: (actorId: string, targetId: string, code: string) => string;
  logError: (message: string) => void;
}

export interface CreateAdminUserInput {
  email: string;
  displayName: string;
  role: AdminRole;
  password: string;
}

export interface UpdateAdminUserInput {
  id: string;
  displayName: string;
  role: AdminRole;
  expectedRole: AdminRole;
}

export interface ResetAdminPasswordInput {
  id: string;
  password: string;
}

export interface ChangeOwnPasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ConfirmAdminUserDeletionInput {
  targetId: string;
  code: string;
}

function failure<T>(error: AdminUserErrorCode): AdminUserResult<T> {
  return { ok: false, error };
}

async function withinManagementLimit(
  dependencies: AdminUserDependencies,
  actor: AdminActor,
): Promise<boolean> {
  const result = await dependencies.consumeRateLimit({
    ...adminUserManagementRateLimit,
    subject: actor.id,
  });
  return result.allowed;
}

export function listAdminUsers(repository: AdminUserRepository): Promise<AdminUserSummary[]> {
  return repository.list();
}

export function getAdminUser(
  repository: AdminUserRepository,
  id: string,
): Promise<AdminUserSummary | null> {
  return repository.findById(id);
}

export async function createAdminUser(
  dependencies: AdminUserDependencies,
  actor: AuthenticatedAdmin,
  input: CreateAdminUserInput,
): Promise<AdminUserResult<AdminUserSummary>> {
  if (!(await withinManagementLimit(dependencies, actor))) {
    return failure("RATE_LIMITED");
  }

  const email = input.email.trim();
  return dependencies.repository.create(actor.id, {
    email,
    emailNormalized: email.toLowerCase(),
    displayName: input.displayName.trim(),
    role: input.role,
    passwordHash: await dependencies.hashPassword(input.password),
  });
}

export async function updateAdminUser(
  dependencies: AdminUserDependencies,
  actor: AdminActor,
  input: UpdateAdminUserInput,
): Promise<AdminUserResult<AdminUserSummary>> {
  if (!(await withinManagementLimit(dependencies, actor))) {
    return failure("RATE_LIMITED");
  }

  return dependencies.repository.update(actor.id, {
    id: input.id,
    displayName: input.displayName.trim(),
    role: input.role,
    expectedRole: input.expectedRole,
  });
}

export async function deactivateAdminUser(
  dependencies: AdminUserDependencies,
  actor: AdminActor,
  id: string,
): Promise<AdminUserResult<SessionRevocation>> {
  if (actor.id === id) {
    return failure("SELF_ACTION");
  }
  if (!(await withinManagementLimit(dependencies, actor))) {
    return failure("RATE_LIMITED");
  }

  return dependencies.repository.deactivate(actor.id, id);
}

export async function reactivateAdminUser(
  dependencies: AdminUserDependencies,
  actor: AdminActor,
  id: string,
): Promise<AdminUserResult<AdminUserSummary>> {
  if (!(await withinManagementLimit(dependencies, actor))) {
    return failure("RATE_LIMITED");
  }

  return dependencies.repository.reactivate(actor.id, id);
}

export async function resetAdminPassword(
  dependencies: AdminUserDependencies,
  actor: AdminActor,
  input: ResetAdminPasswordInput,
): Promise<AdminUserResult<SessionRevocation>> {
  if (actor.id === input.id) {
    return failure("SELF_ACTION");
  }
  if (!(await withinManagementLimit(dependencies, actor))) {
    return failure("RATE_LIMITED");
  }

  return dependencies.repository.resetPassword(
    actor.id,
    input.id,
    await dependencies.hashPassword(input.password),
  );
}

export async function revokeAdminSessions(
  dependencies: AdminUserDependencies,
  actor: AdminActor,
  id: string,
): Promise<AdminUserResult<SessionRevocation>> {
  if (actor.id === id) {
    return failure("SELF_ACTION");
  }
  if (!(await withinManagementLimit(dependencies, actor))) {
    return failure("RATE_LIMITED");
  }

  return dependencies.repository.revokeSessions(actor.id, id);
}

export async function changeOwnPassword(
  dependencies: AdminUserDependencies,
  actor: SessionActor,
  input: ChangeOwnPasswordInput,
): Promise<AdminUserResult<SessionRevocation>> {
  const limit = await dependencies.consumeRateLimit({
    ...adminPasswordChangeRateLimit,
    subject: actor.adminId,
  });
  if (!limit.allowed) {
    return failure("RATE_LIMITED");
  }

  const currentHash = await dependencies.repository.findActivePasswordHash(actor.adminId);
  if (!currentHash || !(await dependencies.verifyPassword(input.currentPassword, currentHash))) {
    return failure("INVALID_CURRENT_PASSWORD");
  }
  if (input.currentPassword === input.newPassword) {
    return failure("SAME_PASSWORD");
  }

  return dependencies.repository.changeOwnPassword(
    actor.adminId,
    actor.sessionId,
    currentHash,
    await dependencies.hashPassword(input.newPassword),
  );
}

export async function requestAdminUserDeletionCode(
  dependencies: AdminUserDependencies,
  actor: AuthenticatedAdmin,
  targetId: string,
): Promise<AdminUserResult<AdminDeletionCodeRecord>> {
  if (actor.id === targetId) {
    return failure("SELF_ACTION");
  }

  const limit = await dependencies.consumeRateLimit({
    ...adminUserDeletionCodeRateLimit,
    subject: actor.id,
  });
  if (!limit.allowed) {
    return failure("RATE_LIMITED");
  }

  const code = dependencies.generateDeletionCode();
  const codeHash = dependencies.hashDeletionCode(actor.id, targetId, code);
  const result = await dependencies.repository.createDeletionCode(actor.id, targetId, codeHash);
  if (!result.ok) {
    return result;
  }

  try {
    await dependencies.notifications.sendDeletionCode({
      to: { email: actor.email, name: actor.displayName },
      actorDisplayName: actor.displayName,
      targetDisplayName: result.value.target.displayName,
      targetEmail: result.value.target.email,
      code,
      expiresInMinutes: result.value.expiresInMinutes,
    });
  } catch {
    dependencies.logError("admin_deletion_code_email_failed");
    await dependencies.repository.invalidateCode(result.value.codeId);
    return failure("EMAIL_DELIVERY_FAILED");
  }

  return result;
}

export async function confirmAdminUserDeletion(
  dependencies: AdminUserDependencies,
  actor: AuthenticatedAdmin,
  input: ConfirmAdminUserDeletionInput,
): Promise<AdminUserResult<SessionRevocation>> {
  if (actor.id === input.targetId) {
    return failure("SELF_ACTION");
  }

  const limit = await dependencies.consumeRateLimit({
    ...adminUserDeletionConfirmRateLimit,
    subject: actor.id,
  });
  if (!limit.allowed) {
    return failure("RATE_LIMITED");
  }

  return dependencies.repository.deleteWithCode(
    actor.id,
    input.targetId,
    dependencies.hashDeletionCode(actor.id, input.targetId, input.code),
  );
}
