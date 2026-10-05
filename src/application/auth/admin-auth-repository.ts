import type { AdminSession, AdminUser, AuthenticatedAdmin } from "./types";

export interface CreatedAdminSession {
  token: string;
  admin: AuthenticatedAdmin;
  expiresAt: Date;
}

export interface AdminAuthRepository {
  findByEmail(emailNormalized: string): Promise<AdminUser | null>;
  createSession(adminId: string): Promise<CreatedAdminSession>;
  validateSession(token: string): Promise<AdminSession | null>;
  deleteSession(token: string): Promise<void>;
}
