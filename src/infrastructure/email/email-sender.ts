import type { EmailSender } from "@/application/ports/email-sender";
import { env } from "@/infrastructure/config/env";

import { createBrevoEmailSender } from "./brevo-email-sender";
import { createLogEmailSender } from "./log-email-sender";

export const emailSender: EmailSender =
  env.EMAIL_MODE === "brevo"
    ? createBrevoEmailSender({
        apiKey: env.BREVO_API_KEY!,
        fromAddress: env.EMAIL_FROM_ADDRESS!,
        fromName: env.EMAIL_FROM_NAME,
      })
    : createLogEmailSender();
