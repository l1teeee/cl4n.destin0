import type {
  AdminUserResult,
  AdminUserSummary,
  CreateAdminUserCommand,
  SessionRevocation,
  UpdateAdminUserCommand,
} from "./types";

export interface AdminUserRepository {
  list(): Promise<AdminUserSummary[]>;
  findById(id: string): Promise<AdminUserSummary | null>;
  create(
    actorId: string,
    command: CreateAdminUserCommand,
  ): Promise<AdminUserResult<AdminUserSummary>>;
  update(
    actorId: string,
    command: UpdateAdminUserCommand,
  ): Promise<AdminUserResult<AdminUserSummary>>;
  deactivate(actorId: string, id: string): Promise<AdminUserResult<SessionRevocation>>;
  reactivate(actorId: string, id: string): Promise<AdminUserResult<AdminUserSummary>>;
  resetPassword(
    actorId: string,
    id: string,
    passwordHash: string,
  ): Promise<AdminUserResult<SessionRevocation>>;
  revokeSessions(actorId: string, id: string): Promise<AdminUserResult<SessionRevocation>>;
  findActivePasswordHash(id: string): Promise<string | null>;
  changeOwnPassword(
    adminId: string,
    keepSessionId: string,
    expectedPasswordHash: string,
    passwordHash: string,
  ): Promise<AdminUserResult<SessionRevocation>>;
}
