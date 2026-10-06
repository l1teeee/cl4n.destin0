import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (authState.token ? { value: authState.token } : undefined)),
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import { changeOwnPasswordAction } from "@/app/admin/(protected)/account/actions";
import AccountPage from "@/app/admin/(protected)/account/page";
import ProtectedAdminLayout from "@/app/admin/(protected)/layout";
import AdminUserDetailPage from "@/app/admin/(protected)/users/[id]/page";
import {
  createAdminUserAction,
  deactivateAdminUserAction,
  updateAdminUserAction,
} from "@/app/admin/(protected)/users/actions";
import NewAdminUserPage from "@/app/admin/(protected)/users/new/page";
import AdminUsersPage from "@/app/admin/(protected)/users/page";
import type { AdminRole } from "@/application/auth/types";
import { hashPassword } from "@/infrastructure/auth/password";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";

import { resetTestDatabase } from "../helpers/test-db";

const initialState = { ok: false, message: "" };
const initialPassword = "clave-inicial-123";
let initialHash: string;
let pool: Pool;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
  initialHash = await hashPassword(initialPassword);
});

beforeEach(async () => {
  authState.token = undefined;
  await pool.query("TRUNCATE rate_limit_counters");
});

afterAll(async () => {
  await pool.end();
});

async function signedInAdmin(role: AdminRole) {
  const email = `${randomUUID()}@example.com`;
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
     VALUES ($1, $1, $2, 'Admin Acciones', $3)
     RETURNING id`,
    [email, initialHash, role],
  );
  const id = inserted.rows[0]!.id;
  authState.token = (await postgresAdminAuthRepository.createSession(id, initialHash))!.token;
  return { id, email };
}

function createForm(email: string, overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("email", email);
  form.set("displayName", "Nuevo Admin");
  form.set("role", "ADMIN");
  form.set("password", "clave-nueva-123");
  form.set("passwordConfirmation", "clave-nueva-123");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

function linkTargets(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) linkTargets(child, found);
    return found;
  }
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: Record<string, unknown> }).props;
    if (typeof props.href === "string") found.push(props.href);
    linkTargets(props.children, found);
  }
  return found;
}

async function adminExists(email: string): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM admin_users WHERE email_normalized = $1", [
    email.toLowerCase(),
  ]);
  return result.rowCount === 1;
}

describe("user management actions", () => {
  it("rejects requests without a session", async () => {
    const email = `${randomUUID()}@example.com`;
    await expect(createAdminUserAction(initialState, createForm(email))).resolves.toEqual({
      ok: false,
      message: "Tu sesión no es válida. Inicia sesión nuevamente.",
    });
    expect(await adminExists(email)).toBe(false);
  });

  it("forbids regular admins", async () => {
    await signedInAdmin("ADMIN");
    const email = `${randomUUID()}@example.com`;

    await expect(createAdminUserAction(initialState, createForm(email))).resolves.toEqual({
      ok: false,
      message: "No tienes permisos para administrar usuarios.",
    });
    expect(await adminExists(email)).toBe(false);
  });

  it("lets super admins create admins and reports validation errors", async () => {
    await signedInAdmin("SUPER_ADMIN");
    const email = `${randomUUID()}@example.com`;

    await expect(
      createAdminUserAction(
        initialState,
        createForm(email, { passwordConfirmation: "otra-clave-123" }),
      ),
    ).resolves.toEqual({ ok: false, message: "Las contraseñas no coinciden." });
    await expect(createAdminUserAction(initialState, createForm(email))).resolves.toEqual({
      ok: true,
      message: `Administrador ${email} creado correctamente.`,
    });
    await expect(createAdminUserAction(initialState, createForm(email))).resolves.toEqual({
      ok: false,
      message: "Ya existe un administrador con ese email.",
    });
  });

  it("explains self-protection errors", async () => {
    const self = await signedInAdmin("SUPER_ADMIN");
    const form = new FormData();
    form.set("displayName", "Yo");
    form.set("role", "ADMIN");
    form.set("expectedRole", "SUPER_ADMIN");

    await expect(updateAdminUserAction(self.id, initialState, form)).resolves.toEqual({
      ok: false,
      message: "No puedes cambiar tu propio rol.",
    });
    await expect(deactivateAdminUserAction(self.id, initialState, new FormData())).resolves.toEqual(
      { ok: false, message: "No puedes desactivar tu propia cuenta." },
    );
  });

  it("reports a stale role and leaves the target unchanged", async () => {
    await signedInAdmin("SUPER_ADMIN");
    const email = `${randomUUID()}@example.com`;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name, role)
       VALUES ($1, $1, $2, 'Actual', 'ADMIN')
       RETURNING id`,
      [email, initialHash],
    );
    const form = new FormData();
    form.set("displayName", "Obsoleto");
    form.set("role", "SUPER_ADMIN");
    form.set("expectedRole", "SUPER_ADMIN");

    await expect(updateAdminUserAction(inserted.rows[0]!.id, initialState, form)).resolves.toEqual({
      ok: false,
      message:
        "El rol de este administrador cambió mientras editabas. Recarga la página e inténtalo de nuevo.",
    });
    await expect(
      pool.query("SELECT display_name, role FROM admin_users WHERE id = $1", [
        inserted.rows[0]!.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ display_name: "Actual", role: "ADMIN" }] });
  });

  it("lets any admin change their own password", async () => {
    await signedInAdmin("ADMIN");
    const form = new FormData();
    form.set("currentPassword", initialPassword);
    form.set("newPassword", "otra-clave-nueva-1");
    form.set("newPasswordConfirmation", "otra-clave-nueva-1");

    await expect(changeOwnPasswordAction(initialState, form)).resolves.toEqual({
      ok: true,
      message: "Contraseña actualizada. Se cerraron tus otras sesiones.",
    });
  });
});

describe("user management pages", () => {
  const userPages = [
    ["users list", () => AdminUsersPage()],
    ["new user", () => NewAdminUserPage()],
    ["user detail", () => AdminUserDetailPage({ params: Promise.resolve({ id: randomUUID() }) })],
  ] as const;

  it.each(userPages)("redirects %s to login without a session", async (_name, render) => {
    await expect(render()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it.each(userPages)("redirects regular admins away from %s", async (_name, render) => {
    await signedInAdmin("ADMIN");
    await expect(render()).rejects.toThrow("REDIRECT:/admin");
  });

  it("renders user pages for super admins and 404s unknown ids", async () => {
    const self = await signedInAdmin("SUPER_ADMIN");

    await expect(AdminUsersPage()).resolves.toBeTruthy();
    await expect(NewAdminUserPage()).resolves.toBeTruthy();
    await expect(
      AdminUserDetailPage({ params: Promise.resolve({ id: self.id }) }),
    ).resolves.toBeTruthy();
    await expect(
      AdminUserDetailPage({ params: Promise.resolve({ id: randomUUID() }) }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      AdminUserDetailPage({ params: Promise.resolve({ id: "no-es-uuid" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("shows the users link only to super admins and the account page to everyone", async () => {
    await signedInAdmin("ADMIN");
    const adminLinks = linkTargets(await ProtectedAdminLayout({ children: null }));
    expect(adminLinks).toContain("/admin/account");
    expect(adminLinks).not.toContain("/admin/users");
    await expect(AccountPage()).resolves.toBeTruthy();

    await signedInAdmin("SUPER_ADMIN");
    expect(linkTargets(await ProtectedAdminLayout({ children: null }))).toContain("/admin/users");
  });
});
