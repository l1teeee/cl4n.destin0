import type { EmailSender } from "@/application/ports/email-sender";

export function createLogEmailSender(write: (line: string) => void = console.info): EmailSender {
  return {
    async send(email) {
      const recipient = email.to.name ? `${email.to.name} <${email.to.email}>` : email.to.email;

      write(`To: ${recipient}\nSubject: ${email.subject}\n\n${email.text}`);
    },
  };
}
