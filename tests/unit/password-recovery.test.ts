import { describe, expect, it, vi, type Mock } from "vitest";

import {
  completePasswordReset,
  PASSWORD_RESET_TTL_MINUTES,
  requestPasswordReset,
  type PasswordResetRepository,
} from "@/application/auth/password-recovery";
import {
  adminPasswordResetCompleteSchema,
  adminPasswordResetRequestSchema,
  adminSignInSchema,
} from "@/contracts/admin-auth";

const validToken = "A".repeat(43);

function fakeRepository(overrides: Partial<Record<keyof PasswordResetRepository, Mock>> = {}) {
  return {
    issueToken: vi.fn().mockResolvedValue(null),
    complete: vi.fn().mockResolvedValue(false),
    ...overrides,
  } satisfies Record<keyof PasswordResetRepository, Mock>;
}

const allowAll = async () => ({ allowed: true });

describe("requestPasswordReset", () => {
  it("hashes the token before it reaches the repository and returns the raw token", async () => {
    const repository = fakeRepository({
      issueToken: vi.fn().mockResolvedValue({ displayName: "Ana", email: "Ana@Example.com" }),
    });

    const delivery = await requestPasswordReset(
      { email: "  Ana@Example.com ", clientIp: "1.2.3.4" },
      {
        repository,
        consumeRateLimit: allowAll,
        generateToken: () => "raw-token",
        hashToken: (token) => `hash:${token}`,
      },
    );

    expect(delivery).toEqual({
      token: "raw-token",
      recipient: { displayName: "Ana", email: "Ana@Example.com" },
    });
    expect(repository.issueToken).toHaveBeenCalledWith({
      emailNormalized: "ana@example.com",
      tokenHash: "hash:raw-token",
      ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
    });
    expect(JSON.stringify(repository.issueToken.mock.calls)).not.toContain('"raw-token"');
  });

  it("returns null when the repository finds no active admin", async () => {
    const delivery = await requestPasswordReset(
      { email: "nobody@example.com", clientIp: "1.2.3.4" },
      {
        repository: fakeRepository(),
        consumeRateLimit: allowAll,
        generateToken: () => "raw-token",
        hashToken: (token) => `hash:${token}`,
      },
    );

    expect(delivery).toBeNull();
  });

  it.each([
    ["admin-password-reset:ip", "ip"],
    ["admin-password-reset:email", "email"],
  ])("never touches the repository when %s is exhausted", async (blockedScope) => {
    const repository = fakeRepository();

    const delivery = await requestPasswordReset(
      { email: "ana@example.com", clientIp: "1.2.3.4" },
      {
        repository,
        consumeRateLimit: async (input) => ({ allowed: input.scope !== blockedScope }),
        generateToken: () => "raw-token",
        hashToken: (token) => `hash:${token}`,
      },
    );

    expect(delivery).toBeNull();
    expect(repository.issueToken).not.toHaveBeenCalled();
  });

  it("rate limits by ip and by normalized email with the approved quotas", async () => {
    const consumeRateLimit = vi.fn(allowAll);

    await requestPasswordReset(
      { email: "Ana@Example.com", clientIp: "1.2.3.4" },
      {
        repository: fakeRepository(),
        consumeRateLimit,
        generateToken: () => "raw-token",
        hashToken: (token) => token,
      },
    );

    expect(consumeRateLimit).toHaveBeenCalledWith({
      scope: "admin-password-reset:ip",
      subject: "1.2.3.4",
      limit: 5,
      windowSeconds: 900,
    });
    expect(consumeRateLimit).toHaveBeenCalledWith({
      scope: "admin-password-reset:email",
      subject: "ana@example.com",
      limit: 3,
      windowSeconds: 900,
    });
  });
});

describe("completePasswordReset", () => {
  it("hashes the token and the password before calling the repository", async () => {
    const repository = fakeRepository({ complete: vi.fn().mockResolvedValue(true) });

    const result = await completePasswordReset(
      { token: "raw-token", password: "plain-password-123", clientIp: "1.2.3.4" },
      {
        repository,
        consumeRateLimit: allowAll,
        hashToken: (token) => `hash:${token}`,
        hashPassword: async (password) => `scrypt:${password}`,
      },
    );

    expect(result).toEqual({ ok: true });
    expect(repository.complete).toHaveBeenCalledWith("hash:raw-token", "scrypt:plain-password-123");
  });

  it("returns the generic error when the repository rejects the token", async () => {
    const result = await completePasswordReset(
      { token: "raw-token", password: "plain-password-123", clientIp: "1.2.3.4" },
      {
        repository: fakeRepository(),
        consumeRateLimit: allowAll,
        hashToken: (token) => token,
        hashPassword: async (password) => password,
      },
    );

    expect(result).toEqual({ ok: false, error: "INVALID_LINK" });
  });

  it("returns the same generic error and skips all work when rate limited", async () => {
    const repository = fakeRepository({ complete: vi.fn().mockResolvedValue(true) });
    const hashPassword = vi.fn(async (password: string) => password);
    const consumeRateLimit = vi.fn(async () => ({ allowed: false }));

    const result = await completePasswordReset(
      { token: "raw-token", password: "plain-password-123", clientIp: "1.2.3.4" },
      { repository, consumeRateLimit, hashToken: (token) => token, hashPassword },
    );

    expect(result).toEqual({ ok: false, error: "INVALID_LINK" });
    expect(consumeRateLimit).toHaveBeenCalledWith({
      scope: "admin-password-reset-complete:ip",
      subject: "1.2.3.4",
      limit: 10,
      windowSeconds: 900,
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});

describe("admin auth contracts", () => {
  it("applies the same email rules to sign-in and password reset requests", () => {
    for (const email of ["not-an-email", "", `${"a".repeat(250)}@example.com`]) {
      expect(adminSignInSchema.safeParse({ email, password: "x" }).success).toBe(false);
      expect(adminPasswordResetRequestSchema.safeParse({ email }).success).toBe(false);
    }
    expect(adminPasswordResetRequestSchema.parse({ email: " ana@example.com " })).toEqual({
      email: "ana@example.com",
    });
  });

  it("accepts a well formed completion payload", () => {
    const parsed = adminPasswordResetCompleteSchema.safeParse({
      token: validToken,
      password: "a-long-enough-password",
      passwordConfirmation: "a-long-enough-password",
    });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ["a short password", { password: "short", passwordConfirmation: "short" }],
    ["mismatched passwords", { passwordConfirmation: "another-long-password" }],
    ["a malformed token", { token: "not-a-token" }],
    [
      "a control character",
      { password: "long-password-\n1", passwordConfirmation: "long-password-\n1" },
    ],
  ])("rejects %s", (_label, overrides) => {
    const parsed = adminPasswordResetCompleteSchema.safeParse({
      token: validToken,
      password: "a-long-enough-password",
      passwordConfirmation: "a-long-enough-password",
      ...overrides,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const parsed = adminPasswordResetCompleteSchema.safeParse({
      token: validToken,
      password: "a-long-enough-password",
      passwordConfirmation: "a-long-enough-password",
      id: "x",
    });

    expect(parsed.success).toBe(false);
  });
});
