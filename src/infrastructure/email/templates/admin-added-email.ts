import type { AdminRole } from "@/domain/admin/admin-access";
import { emailFontFamily, emailHeading, emailOutlinedButton, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import { escapeHtml } from "./escape-html";
import type { RenderedEmail } from "./rendered-email";

const roleLabels: Record<AdminRole, string> = {
  SUPER_ADMIN: "super administrador",
  ADMIN: "administrador",
};

function smallParagraph(text: string): string {
  return `<tr>
<td style="font-family:${emailFontFamily};font-size:12px;line-height:1.6;color:#8d8b85;padding-top:16px;padding-bottom:8px;">${escapeHtml(text)}</td>
</tr>`;
}

export function adminAddedEmail(input: {
  displayName: string;
  role: AdminRole;
  addedByDisplayName: string;
  loginUrl: string;
}): RenderedEmail {
  const subject = "Te agregaron a la administración de Clandestino";
  const preheader = "Ya tienes acceso al panel.";
  const heading = "Ya formas parte de la administración";
  const intro = `${input.displayName}, ${input.addedByDisplayName} te dio acceso como ${roleLabels[input.role]}.`;
  const passwordNote =
    "Tu contraseña te la entregará esa persona por un canal seguro. Nunca la enviamos por correo.";
  const buttonLabel = "Entrar al panel";
  const ignoreNote = "Si no esperabas este acceso, ignora este correo.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(intro),
    emailParagraph(passwordNote),
    emailOutlinedButton(buttonLabel, input.loginUrl),
    smallParagraph(ignoreNote),
  ].join("\n");

  const text = [heading, intro, passwordNote, `${buttonLabel}: ${input.loginUrl}`, ignoreNote].join(
    "\n\n",
  );

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
