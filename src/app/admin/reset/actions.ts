"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { completePasswordReset } from "@/application/auth/password-recovery";
import {
  adminPasswordResetCompleteSchema,
  PASSWORD_RESET_INVALID_LINK_MESSAGE,
} from "@/contracts/admin-auth";
import { hashPassword } from "@/infrastructure/auth/password";
import { hashPasswordResetToken } from "@/infrastructure/auth/password-reset-token";
import { postgresPasswordResetRepository } from "@/infrastructure/auth/postgres-password-reset-repository";
import { scheduleEmailDelivery } from "@/infrastructure/email/outbox/schedule-email-delivery";
import { getRateLimitSubject, getRawClientIp } from "@/infrastructure/http/client-ip";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";

export interface PasswordResetFormState {
  message: string;
}

export async function completePasswordResetAction(
  _previousState: PasswordResetFormState,
  formData: FormData,
): Promise<PasswordResetFormState> {
  const parsed = adminPasswordResetCompleteSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? PASSWORD_RESET_INVALID_LINK_MESSAGE };
  }

  const clientIp = getRawClientIp(await headers());
  const result = await completePasswordReset(
    {
      token: parsed.data.token,
      password: parsed.data.password,
      clientIp: getRateLimitSubject(clientIp),
    },
    {
      repository: postgresPasswordResetRepository,
      consumeRateLimit: consume,
      hashToken: hashPasswordResetToken,
      hashPassword,
    },
  );
  if (!result.ok) {
    return { message: PASSWORD_RESET_INVALID_LINK_MESSAGE };
  }

  scheduleEmailDelivery();
  redirect("/admin/login?restablecida=1");
}
