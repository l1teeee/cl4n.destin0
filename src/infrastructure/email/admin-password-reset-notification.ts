import type { PasswordResetDelivery } from "@/application/auth/password-recovery";
import { PASSWORD_RESET_TTL_MINUTES } from "@/application/auth/password-recovery";
import { env } from "@/infrastructure/config/env";

import { emailSender } from "./email-sender";
import { adminPasswordResetEmail } from "./templates/admin-password-reset-email";

// WHY: sent directly, never through the outbox, because the email carries a live secret that
// must not be stored in the database.
export async function sendAdminPasswordResetEmail(delivery: PasswordResetDelivery): Promise<void> {
  // WHY: the token travels in the URL fragment, which browsers never send to the server, so it
  // cannot appear in Vercel, proxy or application request logs.
  const resetUrl = `${env.APP_BASE_URL}/admin/reset#token=${delivery.token}`;
  const rendered = adminPasswordResetEmail({
    displayName: delivery.recipient.displayName,
    resetUrl,
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  });
  await emailSender.send({
    to: { email: delivery.recipient.email, name: delivery.recipient.displayName },
    ...rendered,
  });
}
