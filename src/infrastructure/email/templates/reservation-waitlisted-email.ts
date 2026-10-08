import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { emailDetailRow, emailHeading, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

export function reservationWaitlistedEmail(input: {
  fullName: string;
  position: number;
  partySize: number;
  eventStartsAt: Date;
}): RenderedEmail {
  const subject = "Estás en la cola del clan";
  const position = `#${input.position}`;
  const preheader = `Posición ${position} en la cola.`;
  const heading = "Quedaste en la cola";
  const intro = `${input.fullName}, los lugares se agotaron, pero tienes un lugar en la cola.`;
  const partySize = String(input.partySize);
  const eventDate = formatPublicEventDate(input.eventStartsAt);
  const closing =
    "Si se libera un lugar, te avisaremos por este medio. No necesitas hacer nada más.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(intro),
    emailDetailRow("Posición", position),
    emailDetailRow("Personas", partySize),
    emailDetailRow("Fecha", eventDate),
    emailParagraph(closing),
  ].join("\n");

  const text = [
    heading,
    intro,
    `Posición: ${position}`,
    `Personas: ${partySize}`,
    `Fecha: ${eventDate}`,
    closing,
  ].join("\n\n");

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
