import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AdminSession } from "@/application/auth/types";
import type { AdminAuthRepository } from "@/application/auth/admin-auth-repository";

import { env } from "../config/env";
import { sessionCookieName } from "./cookie";
import { postgresAdminAuthRepository } from "./session-store";

export type AdminAuthorizationResult =
  | { authorized: true; session: AdminSession; token: string }
  | { authorized: false; error: "UNAUTHORIZED" };

export async function authorizeAdminSession(
  token: string | undefined,
  repository: AdminAuthRepository,
): Promise<AdminAuthorizationResult> {
  const session = token ? await repository.validateSession(token) : null;
  return token && session
    ? { authorized: true, session, token }
    : { authorized: false, error: "UNAUTHORIZED" };
}

export async function requireAdmin(
  mode: "page",
): Promise<AdminAuthorizationResult & { authorized: true }>;
export async function requireAdmin(mode: "action"): Promise<AdminAuthorizationResult>;
export async function requireAdmin(
  mode: "page" | "action" = "page",
): Promise<AdminAuthorizationResult> {
  const store = await cookies();
  const token = store.get(sessionCookieName(env.APP_ENV))?.value;
  const authorization = await authorizeAdminSession(token, postgresAdminAuthRepository);

  if (!authorization.authorized) {
    if (mode === "page") {
      redirect("/admin/login");
    }
    return { authorized: false, error: "UNAUTHORIZED" };
  }

  return authorization;
}
