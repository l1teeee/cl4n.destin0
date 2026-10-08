import { emailHeading, emailOutlinedButton, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

export function adminPasswordResetEmail(input: {
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const subject = "Recupera tu contraseña";
  const preheader = `El enlace vence en ${input.expiresInMinutes} minutos.`;
  const heading = "Recupera tu contraseña";
  const intro = `${input.displayName}, recibimos una solicitud para cambiar tu contraseña.`;
  const buttonLabel = "Crear nueva contraseña";
  const expiry = `El enlace vence en ${input.expiresInMinutes} minutos y solo funciona una vez.`;
  const ignoreNote = "Si no lo pediste, ignora este correo. Tu contraseña no cambiará.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(intro),
    emailOutlinedButton(buttonLabel, input.resetUrl),
    emailParagraph(expiry),
    emailParagraph(ignoreNote),
  ].join("\n");

  const text = [heading, intro, `${buttonLabel}:\n${input.resetUrl}`, expiry, ignoreNote].join(
    "\n\n",
  );

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
