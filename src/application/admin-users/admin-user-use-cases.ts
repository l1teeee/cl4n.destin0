import type { AdminRole } from "@/domain/admin/admin-access";

import type { AdminUserRepository } from "./admin-user-repository";
import type {
  AdminActor,
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

export interface AdminUserDependencies {
  repository: AdminUserRepository;
  consumeRateLimit: (input: RateLimitInput) => Promise<RateLimitResult>;
  hashPassword: (password: string) => Promise<string>;
  verifyPassword: (password: string, encoded: string) => Promise<boolean>;
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
}

export interface ResetAdminPasswordInput {
  id: string;
  password: string;
}

export interface ChangeOwnPasswordInput {
  currentPassword: string;
  newPassword: string;
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
  actor: AdminActor,
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
