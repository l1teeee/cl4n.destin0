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

export function emailDetailRow(label: string, value: string): string {
  return `<tr>
<td style="padding-top:16px;">
<div style="font-family:${emailFontFamily};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8d8b85;">${escapeHtml(label)}</div>
<div style="font-family:${emailFontFamily};font-size:15px;color:#fffbf4;padding-top:4px;">${escapeHtml(value)}</div>
</td>
</tr>`;
}

export function emailOutlinedButton(label: string, href: string): string {
  return `<tr>
<td style="padding-top:24px;padding-bottom:8px;">
<a href="${escapeHtml(href)}" style="display:inline-block;font-family:${emailFontFamily};font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#fffbf4;text-decoration:none;border:1px solid #fffbf4;padding:12px 28px;">${escapeHtml(label)}</a>
</td>
</tr>`;
}
