import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { emailHeading, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

export function reservationCancelledEmail(input: {
  fullName: string;
  reservationNumber: number | null;
  eventStartsAt: Date;
}): RenderedEmail {
  const eventDate = formatPublicEventDate(input.eventStartsAt);
  const isWaitlistEntry = input.reservationNumber === null;
  const subject = isWaitlistEntry ? "Saliste de la cola" : "Tu reserva fue cancelada";
  const preheader = isWaitlistEntry
    ? "Tu lugar en la cola fue retirado."
    : "Tu reserva fue cancelada.";
  const intro = isWaitlistEntry
    ? `${input.fullName}, tu lugar en la cola para ${eventDate} fue retirado.`
    : `${input.fullName}, tu reserva #${input.reservationNumber} para ${eventDate} fue cancelada.`;
  const closing = "Si crees que es un error, responde a la persona que te invitó al clan.";

  const bodyHtml = [emailHeading(subject), emailParagraph(intro), emailParagraph(closing)].join(
    "\n",
  );

  const text = [subject, intro, closing].join("\n\n");

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
