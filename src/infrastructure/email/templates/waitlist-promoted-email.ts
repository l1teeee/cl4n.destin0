import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { emailDetailRow, emailHeading, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

export function waitlistPromotedEmail(input: {
  fullName: string;
  reservationNumber: number;
  partySize: number;
  eventStartsAt: Date;
}): RenderedEmail {
  const subject = "Se liberó un lugar: estás dentro";
  const reservationNumber = `#${String(input.reservationNumber).padStart(3, "0")}`;
  const preheader = `Reserva ${reservationNumber} confirmada.`;
  const heading = "Entraste al clan";
  const intro = `${input.fullName}, se liberó un lugar y tu reserva quedó confirmada.`;
  const partySize = String(input.partySize);
  const eventDate = formatPublicEventDate(input.eventStartsAt);
  const closing = "Guarda este correo como comprobante de tu reserva.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(intro),
    emailDetailRow("Reserva", reservationNumber),
    emailDetailRow("Personas", partySize),
    emailDetailRow("Fecha", eventDate),
    emailParagraph(closing),
  ].join("\n");

  const text = [
    heading,
    intro,
    `Reserva: ${reservationNumber}`,
    `Personas: ${partySize}`,
    `Fecha: ${eventDate}`,
    closing,
  ].join("\n\n");

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
