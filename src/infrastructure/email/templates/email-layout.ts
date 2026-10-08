import { escapeHtml } from "./escape-html";

const fontFamily = "'Funnel Sans', Arial, Helvetica, sans-serif";

export function renderEmailLayout(input: { preheader: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Clandestino</title>
</head>
<body style="margin:0;padding:0;background-color:#11120d;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#11120d" style="background-color:#11120d;">
<tr>
<td align="center" style="padding:48px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr>
<td align="center" style="font-family:${fontFamily};font-size:13px;letter-spacing:0.4em;color:#fffbf4;padding-bottom:24px;">CLANDESTINO</td>
</tr>
<tr>
<td style="border-top:1px solid #2b2c26;font-size:0;line-height:0;height:1px;">&nbsp;</td>
</tr>
${input.bodyHtml}
<tr>
<td style="border-top:1px solid #2b2c26;font-size:0;line-height:0;height:1px;">&nbsp;</td>
</tr>
<tr>
<td align="center" style="font-family:${fontFamily};font-size:12px;line-height:1.6;color:#8d8b85;padding-top:24px;">Este correo se envió automáticamente. No respondas a este mensaje.</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}
