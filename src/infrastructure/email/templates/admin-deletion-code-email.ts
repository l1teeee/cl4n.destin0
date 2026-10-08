import { emailFontFamily, emailHeading, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import { escapeHtml } from "./escape-html";
import type { RenderedEmail } from "./rendered-email";

function codeBox(code: string): string {
  return `<tr>
<td align="center" style="padding-top:24px;padding-bottom:8px;">
<div style="display:inline-block;font-family:${emailFontFamily};font-size:32px;letter-spacing:0.3em;color:#fffbf4;border:1px solid #3a3b34;padding:16px 24px;text-align:center;">${escapeHtml(code)}</div>
</td>
</tr>`;
}

export function adminDeletionCodeEmail(input: {
  actorDisplayName: string;
  targetDisplayName: string;
  targetEmail: string;
  code: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const subject = "Código para eliminar un administrador";
  const preheader = `Tu código vence en ${input.expiresInMinutes} minutos.`;
  const heading = "Confirma la eliminación";
  const intro = `${input.actorDisplayName}, pediste eliminar a ${input.targetDisplayName} (${input.targetEmail}) de la administración.`;
  const expiry = `El código vence en ${input.expiresInMinutes} minutos y solo se puede usar una vez.`;
  const warning = "Si no fuiste tú, no compartas este código y cambia tu contraseña de inmediato.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(intro),
    codeBox(input.code),
    emailParagraph(expiry),
    emailParagraph(warning),
  ].join("\n");

  const text = [heading, intro, input.code, expiry, warning].join("\n\n");

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
