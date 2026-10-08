import { escapeHtml } from "./escape-html";

export const emailFontFamily = "'Funnel Sans', Arial, Helvetica, sans-serif";

export function emailHeading(text: string): string {
  return `<tr>
<td style="font-family:${emailFontFamily};font-size:22px;font-weight:400;line-height:1.3;color:#fffbf4;padding-top:32px;padding-bottom:8px;">${escapeHtml(text)}</td>
</tr>`;
}

export function emailParagraph(text: string): string {
  return `<tr>
<td style="font-family:${emailFontFamily};font-size:15px;line-height:1.6;color:#e4e2dd;padding-top:16px;padding-bottom:8px;">${escapeHtml(text)}</td>
</tr>`;
}
