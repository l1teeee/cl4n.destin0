import { describe, expect, it, vi } from "vitest";

import type { AdminAuthRepository } from "@/application/auth/admin-auth-repository";
import { signIn } from "@/application/auth/sign-in";
import type { AdminUser } from "@/application/auth/types";
import {
  clearSessionCookie,
  sessionCookieName,
  sessionCookieOptions,
  setSessionCookie,
} from "@/infrastructure/auth/cookie";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/infrastructure/auth/password";

function repository(admin: AdminUser | null): AdminAuthRepository {
  return {
    findByEmail: vi.fn().mockResolvedValue(admin),
    createSession: vi.fn().mockResolvedValue({
      token: "token",
      admin: { id: "admin-id", email: "admin@example.com", displayName: "Admin", role: "ADMIN" },
      expiresAt: new Date("2026-10-05T00:00:00Z"),
    }),
    validateSession: vi.fn(),
    deleteSession: vi.fn(),
  };
}

const allowedRateLimit = vi.fn().mockResolvedValue({
  allowed: true,
  remaining: 4,
  retryAfterSeconds: 0,
});

describe("password hashing", () => {
  it("hashes with the required format and verifies only the right password", async () => {
    const encoded = await hashPassword("a-secure-password");
    expect(encoded).toMatch(/^scrypt\$32768\$8\$3\$[^$]+\$[^$]+$/);
    await expect(verifyPassword("a-secure-password", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", encoded)).resolves.toBe(false);
  });

  it("rejects passwords shorter than 12 characters", async () => {
    await expect(hashPassword("short-pass")).rejects.toThrow(/12/);
  });
});

describe("signIn", () => {
  it("rejects a session invalidated after password verification and passes the verified hash", async () => {
    const admin: AdminUser = {
      id: "admin-id",
      emailNormalized: "admin@example.com",
      displayName: "Admin",
      passwordHash: "verified-hash",
      role: "ADMIN",
      isActive: true,
    };
    const repo = repository(admin);
    vi.mocked(repo.createSession).mockResolvedValue(null);

    const result = await signIn(
      { email: admin.emailNormalized, password: "valid-password", clientIp: "local" },
      {
        repository: repo,
        consumeRateLimit: allowedRateLimit,
        passwordVerifier: vi.fn().mockResolvedValue(true),
        dummyPasswordHash: DUMMY_PASSWORD_HASH,
      },
    );

    expect(result).toEqual({ ok: false, error: "INVALID_CREDENTIALS" });
    expect(repo.createSession).toHaveBeenCalledWith(admin.id, admin.passwordHash);
  });

  it.each([
    ["unknown", null],
    [
      "inactive",
      {
        id: "inactive-id",
        emailNormalized: "admin@example.com",
        displayName: "Inactive",
        passwordHash: "real-hash-must-not-run",
        role: "ADMIN",
        isActive: false,
      },
    ],
  ] as const)(
    "returns the same error and runs the dummy hash for %s email",
    async (_case, admin) => {
      const verifier = vi.fn().mockResolvedValue(false);
      const result = await signIn(
        { email: "admin@example.com", password: "attempted-password", clientIp: "local" },
        {
          repository: repository(admin),
          consumeRateLimit: allowedRateLimit,
          passwordVerifier: verifier,
          dummyPasswordHash: DUMMY_PASSWORD_HASH,
        },
      );

      expect(result).toEqual({ ok: false, error: "INVALID_CREDENTIALS" });
      expect(verifier).toHaveBeenCalledWith("attempted-password", DUMMY_PASSWORD_HASH);
    },
  );
});

describe("session cookies", () => {
  it.each(["preview", "production"] as const)("uses a secure __Host cookie in %s", (env) => {
    expect(sessionCookieName(env)).toBe("__Host-cl4n_session");
    expect(sessionCookieOptions(env)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it.each(["local", "test"] as const)("uses a non-secure local cookie in %s", (env) => {
    expect(sessionCookieName(env)).toBe("cl4n_session");
    expect(sessionCookieOptions(env).secure).toBe(false);
  });

  it("sets and clears all required cookie flags", () => {
    const store = { set: vi.fn() };
    const expiresAt = new Date("2026-10-05T00:00:00Z");
    setSessionCookie(store, "raw-token", expiresAt, "production");
    clearSessionCookie(store, "production");
    expect(store.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        name: "__Host-cl4n_session",
        value: "raw-token",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
      }),
    );
    expect(store.set).toHaveBeenNthCalledWith(2, expect.objectContaining({ value: "", maxAge: 0 }));
  });
});
