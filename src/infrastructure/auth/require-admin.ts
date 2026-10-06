import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AdminSession } from "@/application/auth/types";
import type { AdminAuthRepository } from "@/application/auth/admin-auth-repository";
import { canManageAdmins } from "@/domain/admin/admin-access";

import { env } from "../config/env";
import { sessionCookieName } from "./cookie";
import { postgresAdminAuthRepository } from "./session-store";

export type AdminAuthorizationResult =
  | { authorized: true; session: AdminSession; token: string }
  | { authorized: false; error: "UNAUTHORIZED" };

export type SuperAdminAuthorizationResult =
  | { authorized: true; session: AdminSession; token: string }
  | { authorized: false; error: "UNAUTHORIZED" | "FORBIDDEN" };

export async function authorizeAdminSession(
  token: string | undefined,
  repository: AdminAuthRepository,
): Promise<AdminAuthorizationResult> {
  const session = token ? await repository.validateSession(token) : null;
  return token && session
    ? { authorized: true, session, token }
    : { authorized: false, error: "UNAUTHORIZED" };
}

export async function authorizeSuperAdminSession(
  token: string | undefined,
  repository: AdminAuthRepository,
): Promise<SuperAdminAuthorizationResult> {
  const authorization = await authorizeAdminSession(token, repository);
  if (!authorization.authorized) {
    return authorization;
  }
  return canManageAdmins(authorization.session.admin.role)
    ? authorization
    : { authorized: false, error: "FORBIDDEN" };
}

async function sessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(sessionCookieName(env.APP_ENV))?.value;
}

export async function requireAdmin(
  mode: "page",
): Promise<AdminAuthorizationResult & { authorized: true }>;
export async function requireAdmin(mode: "action"): Promise<AdminAuthorizationResult>;
export async function requireAdmin(
  mode: "page" | "action" = "page",
): Promise<AdminAuthorizationResult> {
  const authorization = await authorizeAdminSession(
    await sessionToken(),
    postgresAdminAuthRepository,
  );

  if (!authorization.authorized) {
    if (mode === "page") {
      redirect("/admin/login");
    }
    return { authorized: false, error: "UNAUTHORIZED" };
  }

  return authorization;
}

export async function requireSuperAdmin(
  mode: "page",
): Promise<SuperAdminAuthorizationResult & { authorized: true }>;
export async function requireSuperAdmin(mode: "action"): Promise<SuperAdminAuthorizationResult>;
export async function requireSuperAdmin(
  mode: "page" | "action" = "page",
): Promise<SuperAdminAuthorizationResult> {
  const authorization = await authorizeSuperAdminSession(
    await sessionToken(),
    postgresAdminAuthRepository,
  );

  if (!authorization.authorized && mode === "page") {
    redirect(authorization.error === "FORBIDDEN" ? "/admin" : "/admin/login");
  }

  return authorization;
}
