import { EmailDeliveryError } from "@/application/notifications/email-delivery-error";
import type { EmailSender } from "@/application/ports/email-sender";

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

export function createBrevoEmailSender(config: {
  apiKey: string;
  fromAddress: string;
  fromName: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): EmailSender {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;

  return {
    async send(email) {
      const recipient =
        email.to.name === undefined
          ? { email: email.to.email }
          : { email: email.to.email, name: email.to.name };

      let response: Response;

      try {
        response = await fetchImpl(BREVO_EMAIL_URL, {
          method: "POST",
          headers: {
            "api-key": config.apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            sender: { name: config.fromName, email: config.fromAddress },
            to: [recipient],
            subject: email.subject,
            htmlContent: email.html,
            textContent: email.text,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        throw new EmailDeliveryError(null, "Brevo request failed", { cause });
      }

      if (!response.ok) {
        throw new EmailDeliveryError(
          response.status,
          `Brevo rejected the email with status ${response.status}`,
        );
      }
    },
  };
}
