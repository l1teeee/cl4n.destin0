import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const afterCallbacks = vi.hoisted(() => [] as Array<() => Promise<void> | void>);
const emailSend = vi.hoisted(() => vi.fn());

vi.mock("@/infrastructure/email/email-sender", () => ({ emailSender: { send: emailSend } }));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));
vi.mock("next/server", () => ({
  after: vi.fn((callback: () => Promise<void> | void) => {
    afterCallbacks.push(callback);
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import { requestPasswordResetAction } from "@/app/admin/forgot/actions";
import AdminForgotPage from "@/app/admin/forgot/page";
import AdminLoginPage from "@/app/admin/login/page";
import { completePasswordResetAction } from "@/app/admin/reset/actions";
import AdminResetPage from "@/app/admin/reset/page";
import { signIn } from "@/application/auth/sign-in";
import { PASSWORD_RESET_INVALID_LINK_MESSAGE } from "@/contracts/admin-auth";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "@/infrastructure/auth/password";
import { hashPasswordResetToken } from "@/infrastructure/auth/password-reset-token";
import { PostgresPasswordResetRepository } from "@/infrastructure/auth/postgres-password-reset-repository";
import { PostgresAdminAuthRepository } from "@/infrastructure/auth/session-store";
import { consumeWithPool } from "@/infrastructure/rate-limit/postgres-rate-limiter";

import { resetTestDatabase } from "../helpers/test-db";

const oldPassword = "clave-anterior-123";
const newPassword = "clave-nueva-segura-456";
const requestMessage =
  "Si el correo pertenece a un administrador, te enviamos un enlace para crear una nueva contraseña.";
const SUCCESS_REDIRECT = "/admin/login?restablecida=1";
let pool: Pool;
let authRepository: PostgresAdminAuthRepository;
let oldPasswordHash: string;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  authRepository = new PostgresAdminAuthRepository(pool);
  oldPasswordHash = await hashPassword(oldPassword);
});

beforeEach(async () => {
  afterCallbacks.length = 0;
  await pool.query("TRUNCATE rate_limit_counters, admin_password_reset_tokens, email_outbox");
  emailSend.mockReset();
  emailSend.mockResolvedValue(undefined);
});

afterAll(async () => {
  await pool.end();
});

async function insertAdmin(options: { active?: boolean; deleted?: boolean } = {}) {
  const email = `${randomUUID()}@example.com`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (
       email, email_normalized, password_hash, display_name, is_active, deleted_at
     )
     VALUES ($1, $1, $2, 'Admin de prueba', $3, $4)
     RETURNING id`,
    [
      email,
      oldPasswordHash,
      options.active ?? true,
      options.deleted ? new Date().toISOString() : null,
    ],
  );
  return { id: result.rows[0]!.id, email };
}

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    form.set(key, value);
  }
  return form;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT:")) {
      return error.message.slice("REDIRECT:".length);
    }
    throw error;
  }
  throw new Error("Expected a redirect");
}

async function flushAfterCallbacks(): Promise<void> {
  const callbacks = afterCallbacks.splice(0);
  for (const callback of callbacks) {
    await callback();
  }
}

function sentEmailText(): string {
  return emailSend.mock.calls.map(([email]) => `To: ${email.to.email}\n${email.text}`).join("\n");
}

async function requestAndReadToken(email: string): Promise<string> {
  emailSend.mockClear();
  const destination = await redirectOf(() => requestPasswordResetAction(formWith({ email })));
  expect(destination).toBe("/admin/forgot?enviado=1");
  await flushAfterCallbacks();
  const match = /\/admin\/reset#token=([A-Za-z0-9_-]{43})/.exec(sentEmailText());
  expect(match).not.toBeNull();
  return match![1]!;
}

// Returns the redirect target on success, or the form error message on failure.
async function attemptComplete(token: string, password: string = newPassword): Promise<string> {
  try {
    const state = await completePasswordResetAction(
      { message: "" },
      formWith({ token, password, passwordConfirmation: password }),
    );
    return state.message;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT:")) {
      return error.message.slice("REDIRECT:".length);
    }
    throw error;
  }
}

function realSignIn(email: string, password: string) {
  return signIn(
    { email, password, clientIp: randomUUID(), rawClientIp: null },
    {
      repository: authRepository,
      consumeRateLimit: (input) => consumeWithPool(input, pool),
      passwordVerifier: verifyPassword,
      dummyPasswordHash: DUMMY_PASSWORD_HASH,
    },
  );
}

async function insertSession(adminId: string): Promise<void> {
  await pool.query(
    `INSERT INTO admin_sessions (token_hash, admin_user_id, last_seen_at, expires_at)
     VALUES ($1, $2, now(), now() + interval '1 hour')`,
    [randomUUID(), adminId],
  );
}

describe("password recovery request", () => {
  it("stores only the keyed hash of the emailed token, with a 30 minute expiry", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);

    const rows = await pool.query<{ token_hash: string; ttl_seconds: number }>(
      `SELECT token_hash, EXTRACT(EPOCH FROM (expires_at - created_at))::int AS ttl_seconds
         FROM admin_password_reset_tokens WHERE admin_user_id = $1`,
      [admin.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.token_hash).toBe(hashPasswordResetToken(token));
    expect(rows.rows[0]!.token_hash).not.toContain(token);
    expect(rows.rows[0]!.ttl_seconds).toBeGreaterThanOrEqual(1799);
    expect(rows.rows[0]!.ttl_seconds).toBeLessThanOrEqual(1801);
  });

  it("sends the email only after the response, with the token in the fragment", async () => {
    const admin = await insertAdmin();
    await redirectOf(() => requestPasswordResetAction(formWith({ email: admin.email })));

    expect(sentEmailText()).toBe("");
    await flushAfterCallbacks();
    expect(sentEmailText()).toContain(admin.email);
    expect(sentEmailText()).toMatch(/http:\/\/localhost:3000\/admin\/reset#token=/);
    expect(sentEmailText()).not.toContain("/admin/reset?");
  });

  it.each([
    ["unknown", async () => ({ email: `${randomUUID()}@example.com` })],
    ["inactive", async () => insertAdmin({ active: false })],
    ["deleted", async () => insertAdmin({ active: false, deleted: true })],
  ])("gives the same answer and creates nothing for a %s email", async (_label, arrange) => {
    const target = await arrange();
    const admin = await insertAdmin();

    const targetDestination = await redirectOf(() =>
      requestPasswordResetAction(formWith({ email: target.email })),
    );
    expect(afterCallbacks).toHaveLength(0);
    const knownDestination = await redirectOf(() =>
      requestPasswordResetAction(formWith({ email: admin.email })),
    );

    expect(targetDestination).toBe(knownDestination);
    expect(afterCallbacks).toHaveLength(1);
    const tokens = await pool.query("SELECT 1 FROM admin_password_reset_tokens");
    expect(tokens.rowCount).toBe(1);
    const requestAudits = await pool.query(
      "SELECT entity_id FROM audit_logs WHERE action = 'ADMIN_PASSWORD_RESET_REQUESTED' AND entity_id = ANY($1)",
      [[admin.id, "id" in target ? target.id : randomUUID()]],
    );
    expect(requestAudits.rows).toEqual([{ entity_id: admin.id }]);
  });

  it("a second request invalidates the first token", async () => {
    const admin = await insertAdmin();
    const first = await requestAndReadToken(admin.email);
    const second = await requestAndReadToken(admin.email);

    expect(await attemptComplete(first)).toBe(PASSWORD_RESET_INVALID_LINK_MESSAGE);
    expect(await attemptComplete(second)).toBe(SUCCESS_REDIRECT);
  });

  it("rate limits silently by email after 3 requests and by ip after 5", async () => {
    const admin = await insertAdmin();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const destination = await redirectOf(() =>
        requestPasswordResetAction(formWith({ email: admin.email })),
      );
      expect(destination).toBe("/admin/forgot?enviado=1");
    }
    expect(afterCallbacks).toHaveLength(3);

    await pool.query("TRUNCATE rate_limit_counters");
    afterCallbacks.length = 0;
    const admins = [await insertAdmin(), await insertAdmin(), await insertAdmin()];
    for (const other of [...admins, ...admins]) {
      await redirectOf(() => requestPasswordResetAction(formWith({ email: other.email })));
    }
    expect(afterCallbacks).toHaveLength(5);
  });

  it("answers an invalid email with a validation redirect that sends nothing", async () => {
    const destination = await redirectOf(() =>
      requestPasswordResetAction(formWith({ email: "not-an-email" })),
    );

    expect(destination).toBe("/admin/forgot?error=1");
    expect(afterCallbacks).toHaveLength(0);
  });

  it("logs a failed delivery without the token or the email", async () => {
    const admin = await insertAdmin();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    emailSend.mockRejectedValue(new Error(`provider rejected ${admin.email}`));

    try {
      await redirectOf(() => requestPasswordResetAction(formWith({ email: admin.email })));
      await flushAfterCallbacks();

      const logged = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("admin_password_reset_email_failed");
      expect(logged).not.toContain(admin.email);
      expect(logged).not.toMatch(/[A-Za-z0-9_-]{43}/);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("password recovery completion", () => {
  it("changes the password so the old one fails and the new one signs in", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);

    expect(await attemptComplete(token)).toBe(SUCCESS_REDIRECT);

    expect((await realSignIn(admin.email, oldPassword)).ok).toBe(false);
    expect((await realSignIn(admin.email, newPassword)).ok).toBe(true);
  });

  it("works only once", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);

    expect(await attemptComplete(token)).toBe(SUCCESS_REDIRECT);
    expect(await attemptComplete(token, "otra-clave-distinta-789")).toBe(
      PASSWORD_RESET_INVALID_LINK_MESSAGE,
    );
    expect((await realSignIn(admin.email, newPassword)).ok).toBe(true);
  });

  it("rejects an expired token and leaves the password untouched", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);
    await pool.query(
      "UPDATE admin_password_reset_tokens SET expires_at = clock_timestamp() - interval '1 second'",
    );

    expect(await attemptComplete(token)).toBe(PASSWORD_RESET_INVALID_LINK_MESSAGE);
    expect((await realSignIn(admin.email, oldPassword)).ok).toBe(true);
  });

  it.each([
    ["deactivated", "UPDATE admin_users SET is_active = false WHERE id = $1"],
    ["deleted", "UPDATE admin_users SET is_active = false, deleted_at = now() WHERE id = $1"],
  ])("cannot complete for a %s admin", async (_label, statement) => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);
    await pool.query(statement, [admin.id]);

    expect(await attemptComplete(token)).toBe(PASSWORD_RESET_INVALID_LINK_MESSAGE);
    const stored = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM admin_users WHERE id = $1",
      [admin.id],
    );
    expect(stored.rows[0]!.password_hash).toBe(oldPasswordHash);
  });

  it("answers every invalid token the same way", async () => {
    expect(await attemptComplete("B".repeat(43))).toBe(PASSWORD_RESET_INVALID_LINK_MESSAGE);
    expect(await attemptComplete("")).toBe(PASSWORD_RESET_INVALID_LINK_MESSAGE);
    expect(await attemptComplete("short")).toBe(PASSWORD_RESET_INVALID_LINK_MESSAGE);
  });

  it("deletes every session of the admin and only theirs", async () => {
    const admin = await insertAdmin();
    const bystander = await insertAdmin();
    await insertSession(admin.id);
    await insertSession(admin.id);
    await insertSession(bystander.id);
    const token = await requestAndReadToken(admin.email);

    expect(await attemptComplete(token)).toBe(SUCCESS_REDIRECT);

    const remaining = await pool.query<{ admin_user_id: string }>(
      "SELECT admin_user_id FROM admin_sessions WHERE admin_user_id = ANY($1)",
      [[admin.id, bystander.id]],
    );
    expect(remaining.rows.map((row) => row.admin_user_id)).toEqual([bystander.id]);
  });

  it("enqueues the completion notice in the outbox and audits without secrets", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);
    await attemptComplete(token);

    const outbox = await pool.query<{ kind: string; payload: unknown; status: string }>(
      "SELECT kind, payload, status FROM email_outbox WHERE admin_user_id = $1",
      [admin.id],
    );
    expect(outbox.rows).toEqual([
      { kind: "ADMIN_PASSWORD_RESET_COMPLETED", payload: {}, status: "PENDING" },
    ]);

    const audits = await pool.query<{ actor_type: string; action: string; metadata: unknown }>(
      `SELECT actor_type, action, metadata FROM audit_logs
        WHERE entity_id = $1
          AND action IN ('ADMIN_PASSWORD_RESET_REQUESTED', 'ADMIN_PASSWORD_RESET_COMPLETED')
        ORDER BY id`,
      [admin.id],
    );
    expect(audits.rows).toEqual([
      { actor_type: "SYSTEM", action: "ADMIN_PASSWORD_RESET_REQUESTED", metadata: {} },
      { actor_type: "SYSTEM", action: "ADMIN_PASSWORD_RESET_COMPLETED", metadata: {} },
    ]);

    const everything = JSON.stringify([
      (await pool.query("SELECT * FROM audit_logs WHERE entity_id = $1", [admin.id])).rows,
      (await pool.query("SELECT * FROM email_outbox")).rows,
    ]);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(admin.email);
    expect(everything).not.toContain(newPassword);
  });

  it("rolls everything back when a step fails after the password change", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);
    await insertSession(admin.id);
    await pool.query("ALTER TABLE email_outbox ADD CONSTRAINT force_failure_chk CHECK (false)");

    try {
      await expect(attemptComplete(token)).rejects.toThrow();
    } finally {
      await pool.query("ALTER TABLE email_outbox DROP CONSTRAINT force_failure_chk");
    }

    const stored = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM admin_users WHERE id = $1",
      [admin.id],
    );
    expect(stored.rows[0]!.password_hash).toBe(oldPasswordHash);
    const sessions = await pool.query("SELECT 1 FROM admin_sessions WHERE admin_user_id = $1", [
      admin.id,
    ]);
    expect(sessions.rowCount).toBe(1);
    const consumed = await pool.query(
      "SELECT 1 FROM admin_password_reset_tokens WHERE consumed_at IS NOT NULL",
    );
    expect(consumed.rowCount).toBe(0);
    const audit = await pool.query(
      "SELECT 1 FROM audit_logs WHERE action = 'ADMIN_PASSWORD_RESET_COMPLETED' AND entity_id = $1",
      [admin.id],
    );
    expect(audit.rowCount).toBe(0);
  });

  it("rate limits completion attempts to 10 per window", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await attemptComplete("C".repeat(43));
    }

    expect(await attemptComplete(token)).toBe(PASSWORD_RESET_INVALID_LINK_MESSAGE);
    expect((await realSignIn(admin.email, oldPassword)).ok).toBe(true);
  });

  it("reports validation problems without consuming the token", async () => {
    const admin = await insertAdmin();
    const token = await requestAndReadToken(admin.email);
    const state = await completePasswordResetAction(
      { message: "" },
      formWith({ token, password: newPassword, passwordConfirmation: "no-coincide-123456" }),
    );

    expect(state.message).toBe("Las contraseñas no coinciden.");
    expect(await attemptComplete(token)).toBe(SUCCESS_REDIRECT);
  });
});

describe("password recovery without a session", () => {
  it("serves the forgot, reset and login notice pages with no cookies", async () => {
    const forgot = await AdminForgotPage({ searchParams: Promise.resolve({ enviado: "1" }) });
    const reset = AdminResetPage();
    const login = await AdminLoginPage({ searchParams: Promise.resolve({ restablecida: "1" }) });

    expect(renderToStaticMarkup(forgot)).toContain(requestMessage);
    expect(renderToStaticMarkup(reset)).toContain("Nueva contraseña");
    expect(renderToStaticMarkup(login)).toContain(
      "Tu contraseña se actualizó. Ya puedes iniciar sesión.",
    );
    expect(renderToStaticMarkup(login)).toContain("/admin/forgot");
  });

  it("repository ignores an unknown email without error", async () => {
    const repository = new PostgresPasswordResetRepository(pool);

    await expect(
      repository.issueToken({
        emailNormalized: `${randomUUID()}@example.com`,
        tokenHash: "x",
        ttlMinutes: 30,
      }),
    ).resolves.toBeNull();
  });
});
