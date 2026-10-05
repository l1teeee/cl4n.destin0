"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signOut } from "@/application/auth/sign-out";
import { clearSessionCookie } from "@/infrastructure/auth/cookie";
import { env } from "@/infrastructure/config/env";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";

export async function signOutAction(): Promise<void> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) {
    redirect("/admin/login");
  }

  await signOut(postgresAdminAuthRepository, authorization.token);
  clearSessionCookie(await cookies(), env.APP_ENV);
  redirect("/admin/login");
}
