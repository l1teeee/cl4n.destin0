import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AdminSession } from "@/application/auth/types";
import type { AdminAuthRepository } from "@/application/auth/admin-auth-repository";
import { hasPermission, type AdminPermission } from "@/domain/admin/admin-access";

import { env } from "../config/env";
import { sessionCookieName } from "./cookie";
import { postgresAdminAuthRepository } from "./session-store";

export type AdminAuthorizationResult =
  | { authorized: true; session: AdminSession; token: string }
  | { authorized: false; error: "UNAUTHORIZED" };

export type PermissionAuthorizationResult =
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

export async function authorizePermission(
  token: string | undefined,
  repository: AdminAuthRepository,
  permission: AdminPermission,
): Promise<PermissionAuthorizationResult> {
  const authorization = await authorizeAdminSession(token, repository);
  if (!authorization.authorized) {
    return authorization;
  }
  return hasPermission(authorization.session.admin.role, permission)
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
export async function requireAdmin(mode: "route"): Promise<AdminAuthorizationResult>;
export async function requireAdmin(
  mode: "page" | "action" | "route" = "page",
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

export async function requirePermission(
  permission: AdminPermission,
  mode: "page",
): Promise<PermissionAuthorizationResult & { authorized: true }>;
export async function requirePermission(
  permission: AdminPermission,
  mode: "action",
): Promise<PermissionAuthorizationResult>;
export async function requirePermission(
  permission: AdminPermission,
  mode: "page" | "action" = "page",
): Promise<PermissionAuthorizationResult> {
  const authorization = await authorizePermission(
    await sessionToken(),
    postgresAdminAuthRepository,
    permission,
  );

  if (!authorization.authorized && mode === "page") {
    redirect(authorization.error === "FORBIDDEN" ? "/admin" : "/admin/login");
  }

  return authorization;
}
