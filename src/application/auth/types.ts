export interface AdminUser {
  id: string;
  emailNormalized: string;
  displayName: string;
  passwordHash: string;
  isActive: boolean;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  displayName: string;
}

export interface AdminSession {
  id: string;
  admin: AuthenticatedAdmin;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  databaseTime: Date;
}

export type SignInResult =
  | { ok: true; token: string; admin: AuthenticatedAdmin; expiresAt: Date }
  | { ok: false; error: "INVALID_CREDENTIALS" | "RATE_LIMITED"; retryAfterSeconds?: number };
