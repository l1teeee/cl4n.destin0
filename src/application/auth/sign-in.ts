import type { AdminAuthRepository } from "./admin-auth-repository";
import type { SignInResult } from "./types";

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

const adminLoginIpRateLimit = {
  scope: "admin-login:ip",
  limit: 20,
  windowSeconds: 900,
};

const adminLoginEmailRateLimit = {
  scope: "admin-login:email",
  limit: 5,
  windowSeconds: 900,
};

export interface SignInInput {
  email: string;
  password: string;
  clientIp: string;
  rawClientIp: string | null;
}

export interface SignInDependencies {
  repository: AdminAuthRepository;
  consumeRateLimit: (input: RateLimitInput) => Promise<RateLimitResult>;
  passwordVerifier: (password: string, encoded: string) => Promise<boolean>;
  dummyPasswordHash: string;
}

export async function signIn(
  input: SignInInput,
  dependencies: SignInDependencies,
): Promise<SignInResult> {
  const emailNormalized = input.email.trim().toLowerCase();
  const [ipLimit, emailLimit] = await Promise.all([
    dependencies.consumeRateLimit({
      ...adminLoginIpRateLimit,
      subject: input.clientIp,
    }),
    dependencies.consumeRateLimit({
      ...adminLoginEmailRateLimit,
      subject: emailNormalized,
    }),
  ]);

  if (!ipLimit.allowed || !emailLimit.allowed) {
    return {
      ok: false,
      error: "RATE_LIMITED",
      retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds),
    };
  }

  const admin = await dependencies.repository.findByEmail(emailNormalized);
  const encodedHash = admin?.isActive ? admin.passwordHash : dependencies.dummyPasswordHash;
  const passwordMatches = await dependencies.passwordVerifier(input.password, encodedHash);

  if (!admin?.isActive || !passwordMatches) {
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }

  const session = await dependencies.repository.createSession(
    admin.id,
    admin.passwordHash,
    input.rawClientIp,
  );
  if (!session) {
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }
  return {
    ok: true,
    token: session.token,
    admin: session.admin,
    expiresAt: session.expiresAt,
  };
}
