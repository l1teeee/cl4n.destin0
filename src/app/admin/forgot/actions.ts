"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import {
  checkPasswordResetRateLimits,
  issuePasswordReset,
} from "@/application/auth/password-recovery";
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
  const allowed = await checkPasswordResetRateLimits(
    { email: parsed.data.email, clientIp: getRateLimitSubject(clientIp) },
    { consumeRateLimit: consume },
  );

  if (allowed) {
    // WHY: account lookup, token issuance and delivery all run after the response, so the
    // synchronous path cannot reveal whether the email belongs to an admin.
    after(async () => {
      try {
        const delivery = await issuePasswordReset(
          { email: parsed.data.email },
          {
            repository: postgresPasswordResetRepository,
            generateToken: generatePasswordResetToken,
            hashToken: hashPasswordResetToken,
          },
        );
        if (delivery) {
          await sendAdminPasswordResetEmail(delivery);
        }
      } catch {
        // Provider and repository errors may contain the recipient or token.
        log("error", "admin_password_reset_email_failed");
      }
    });
  }

  redirect("/admin/forgot?enviado=1");
}
