"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { requestPasswordReset } from "@/application/auth/password-recovery";
import { adminPasswordResetRequestSchema } from "@/contracts/admin-auth";
import { postgresPasswordResetRepository } from "@/infrastructure/auth/postgres-password-reset-repository";
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
} from "@/infrastructure/auth/password-reset-token";
import { sendAdminPasswordResetEmail } from "@/infrastructure/email/admin-password-reset-notification";
import { getRateLimitSubject, getRawClientIp } from "@/infrastructure/http/client-ip";
import { log } from "@/infrastructure/observability/logger";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const parsed = adminPasswordResetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/admin/forgot?error=1");
  }

  const clientIp = getRawClientIp(await headers());
  const delivery = await requestPasswordReset(
    { email: parsed.data.email, clientIp: getRateLimitSubject(clientIp) },
    {
      repository: postgresPasswordResetRepository,
      consumeRateLimit: consume,
      generateToken: generatePasswordResetToken,
      hashToken: hashPasswordResetToken,
    },
  );

  if (delivery) {
    // WHY: sending after the response keeps the response time identical whether or not the
    // account exists, so timing cannot be used to enumerate admins.
    after(async () => {
      try {
        await sendAdminPasswordResetEmail(delivery);
      } catch {
        // The error is dropped on purpose: provider errors can echo the recipient address.
        log("error", "admin_password_reset_email_failed");
      }
    });
  }

  redirect("/admin/forgot?enviado=1");
}
