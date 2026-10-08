import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { emailFontFamily, emailHeading, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import { escapeHtml } from "./escape-html";
import type { RenderedEmail } from "./rendered-email";

function detailRow(label: string, value: string): string {
  return `<tr>
<td style="padding-top:16px;">
<div style="font-family:${emailFontFamily};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#8d8b85;">${escapeHtml(label)}</div>
<div style="font-family:${emailFontFamily};font-size:15px;color:#fffbf4;padding-top:4px;">${escapeHtml(value)}</div>
</td>
</tr>`;
}

export function reservationConfirmationEmail(input: {
  fullName: string;
  reservationNumber: number;
  partySize: number;
  eventStartsAt: Date;
}): RenderedEmail {
  const subject = "Tu lugar en el clan está confirmado";
  const reservationNumber = `#${String(input.reservationNumber).padStart(3, "0")}`;
  const preheader = `Reserva ${reservationNumber} confirmada.`;
  const heading = "Tu lugar está confirmado";
  const greeting = `${input.fullName}, el clan te espera.`;
  const partySize = String(input.partySize);
  const eventDate = formatPublicEventDate(input.eventStartsAt);
  const closing = "Guarda este correo como comprobante de tu reserva.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(greeting),
    detailRow("Reserva", reservationNumber),
    detailRow("Personas", partySize),
    detailRow("Fecha", eventDate),
    emailParagraph(closing),
  ].join("\n");

  const text = [
    heading,
    greeting,
    `Reserva: ${reservationNumber}`,
    `Personas: ${partySize}`,
    `Fecha: ${eventDate}`,
    closing,
  ].join("\n\n");

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
