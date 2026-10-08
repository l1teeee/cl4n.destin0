"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/application/auth/sign-in";
import { adminSignInSchema } from "@/contracts/admin-auth";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/infrastructure/auth/password";
import { setSessionCookie } from "@/infrastructure/auth/cookie";
import { env } from "@/infrastructure/config/env";
import { getRateLimitSubject, getRawClientIp } from "@/infrastructure/http/client-ip";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";
import { scheduleEmailDelivery } from "@/infrastructure/email/outbox/schedule-email-delivery";
import { postgresAdminAuthRepository } from "@/infrastructure/auth/session-store";

export async function signInAction(formData: FormData): Promise<void> {
  const parsed = adminSignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect("/admin/login?error=1");
  }

  const requestHeaders = await headers();
  const clientIp = getRawClientIp(requestHeaders);
  const result = await signIn(
    {
      ...parsed.data,
      clientIp: getRateLimitSubject(clientIp),
      rawClientIp: clientIp,
    },
    {
      repository: postgresAdminAuthRepository,
      consumeRateLimit: consume,
      passwordVerifier: verifyPassword,
      dummyPasswordHash: DUMMY_PASSWORD_HASH,
    },
  );

  if (!result.ok) {
    redirect("/admin/login?error=1");
  }

  scheduleEmailDelivery();
  setSessionCookie(await cookies(), result.token, result.expiresAt, env.APP_ENV);
  redirect("/admin");
}
