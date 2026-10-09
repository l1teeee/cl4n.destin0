import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { emailDetailRow, emailHeading, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

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
  const locationNotice =
    "Te enviaremos la ubicación por correo antes de la experiencia. No le digas a nadie.";
  const closing = "Guarda este correo como comprobante de tu reserva.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(greeting),
    emailDetailRow("Reserva", reservationNumber),
    emailDetailRow("Personas", partySize),
    emailDetailRow("Fecha", eventDate),
    emailParagraph(locationNotice),
    emailParagraph(closing),
  ].join("\n");

  const text = [
    heading,
    greeting,
    `Reserva: ${reservationNumber}`,
    `Personas: ${partySize}`,
    `Fecha: ${eventDate}`,
    locationNotice,
    closing,
  ].join("\n\n");

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
