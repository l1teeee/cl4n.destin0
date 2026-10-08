export const PASSWORD_RESET_TTL_MINUTES = 30;

export interface PasswordResetRecipient {
  displayName: string;
  email: string;
}

export interface IssuePasswordResetTokenInput {
  emailNormalized: string;
  tokenHash: string;
  ttlMinutes: number;
}

export interface PasswordResetRepository {
  /** Returns null when no active admin owns the email, or a concurrent request already issued a token. */
  issueToken(input: IssuePasswordResetTokenInput): Promise<PasswordResetRecipient | null>;
  /** Returns false for any invalid, expired, consumed or inactive case. */
  complete(tokenHash: string, passwordHash: string): Promise<boolean>;
}

interface RateLimitInput {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
}

type ConsumeRateLimit = (input: RateLimitInput) => Promise<RateLimitResult>;

const requestIpRateLimit = {
  scope: "admin-password-reset:ip",
  limit: 5,
  windowSeconds: 900,
};

const requestEmailRateLimit = {
  scope: "admin-password-reset:email",
  limit: 3,
  windowSeconds: 900,
};

const completeIpRateLimit = {
  scope: "admin-password-reset-complete:ip",
  limit: 10,
  windowSeconds: 900,
};

export interface RequestPasswordResetInput {
  email: string;
  clientIp: string;
}

export interface CheckPasswordResetRateLimitsDependencies {
  consumeRateLimit: ConsumeRateLimit;
}

export interface IssuePasswordResetDependencies {
  repository: PasswordResetRepository;
  generateToken: () => string;
  hashToken: (token: string) => string;
}

export interface PasswordResetDelivery {
  token: string;
  recipient: PasswordResetRecipient;
}

export async function checkPasswordResetRateLimits(
  input: RequestPasswordResetInput,
  dependencies: CheckPasswordResetRateLimitsDependencies,
): Promise<boolean> {
  const emailNormalized = input.email.trim().toLowerCase();
  const [ipLimit, emailLimit] = await Promise.all([
    dependencies.consumeRateLimit({ ...requestIpRateLimit, subject: input.clientIp }),
    dependencies.consumeRateLimit({ ...requestEmailRateLimit, subject: emailNormalized }),
  ]);
  return ipLimit.allowed && emailLimit.allowed;
}

/** The caller must not let the outcome (delivery or null) change what the visitor sees. */
export async function issuePasswordReset(
  input: Pick<RequestPasswordResetInput, "email">,
  dependencies: IssuePasswordResetDependencies,
): Promise<PasswordResetDelivery | null> {
  const emailNormalized = input.email.trim().toLowerCase();
  const token = dependencies.generateToken();
  const recipient = await dependencies.repository.issueToken({
    emailNormalized,
    tokenHash: dependencies.hashToken(token),
    ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
  });
  return recipient ? { token, recipient } : null;
}

export interface CompletePasswordResetInput {
  token: string;
  password: string;
  clientIp: string;
}

export interface CompletePasswordResetDependencies {
  repository: PasswordResetRepository;
  consumeRateLimit: ConsumeRateLimit;
  hashToken: (token: string) => string;
  hashPassword: (password: string) => Promise<string>;
}

export type CompletePasswordResetResult = { ok: true } | { ok: false; error: "INVALID_LINK" };

export async function completePasswordReset(
  input: CompletePasswordResetInput,
  dependencies: CompletePasswordResetDependencies,
): Promise<CompletePasswordResetResult> {
  const ipLimit = await dependencies.consumeRateLimit({
    ...completeIpRateLimit,
    subject: input.clientIp,
  });
  if (!ipLimit.allowed) {
    return { ok: false, error: "INVALID_LINK" };
  }

  // WHY: hashing before the transaction keeps the token and admin row locks off the slow scrypt call.
  const passwordHash = await dependencies.hashPassword(input.password);
  const completed = await dependencies.repository.complete(
    dependencies.hashToken(input.token),
    passwordHash,
  );
  return completed ? { ok: true } : { ok: false, error: "INVALID_LINK" };
}
