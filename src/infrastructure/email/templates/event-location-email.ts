import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

import {
  emailDetailRow,
  emailHeading,
  emailImage,
  emailLinkRow,
  emailMultilineDetailRow,
  emailOutlinedButton,
  emailParagraph,
} from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

export interface EventLocationEmailInput {
  fullName: string;
  reservationNumber: number;
  partySize: number;
  eventStartsAt: Date;
  locationName: string | null;
  locationAddress: string | null;
  locationMapsUrl: string | null;
  locationNotes: string | null;
  imageTokens: string[];
  appBaseUrl: string;
  isUpdate: boolean;
}

function mapsUrl(input: EventLocationEmailInput): string {
  if (input.locationMapsUrl) return input.locationMapsUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(input.locationAddress!)}`;
}

export function eventLocationEmail(input: EventLocationEmailInput): RenderedEmail {
  const subject = input.isUpdate
    ? "Cambio de lugar: nueva ubicación"
    : "El lugar ha sido verificado";
  const heading = input.isUpdate ? "El lugar cambió" : "El lugar ha sido verificado";
  const greeting = `${input.fullName}, esta es la ubicación. El clan te espera.`;
  const updateNotice = "Esta ubicación reemplaza la que te enviamos antes.";
  const reservationNumber = `#${String(input.reservationNumber).padStart(3, "0")}`;
  const eventDate = formatPublicEventDate(input.eventStartsAt);
  const partySize = String(input.partySize);
  const locationUrl = mapsUrl(input);
  const closing = "No compartas esta ubicación. No le digas a nadie.";
  const baseUrl = input.appBaseUrl.replace(/\/$/, "");
  const imageUrls = input.imageTokens
    .slice(0, 6)
    .map((token) => `${baseUrl}/ubicacion/foto/${token}`);

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(greeting),
    ...(input.isUpdate ? [emailParagraph(updateNotice)] : []),
    emailDetailRow("Fecha", eventDate),
    emailDetailRow("Reserva", reservationNumber),
    emailDetailRow("Personas", partySize),
    ...(input.locationName ? [emailDetailRow("Lugar", input.locationName)] : []),
    ...(input.locationAddress ? [emailDetailRow("Dirección", input.locationAddress)] : []),
    ...(input.locationNotes ? [emailMultilineDetailRow("Indicaciones", input.locationNotes)] : []),
    emailOutlinedButton("Abrir en Google Maps", locationUrl),
    emailLinkRow("Google Maps", locationUrl),
    ...(imageUrls.length > 0 ? [emailParagraph("Fotos del lugar")] : []),
    ...imageUrls.map((url) => emailImage(url, "Foto del lugar")),
    emailParagraph(closing),
  ].join("\n");

  const text = [
    heading,
    greeting,
    ...(input.isUpdate ? [updateNotice] : []),
    `Fecha: ${eventDate}`,
    `Reserva: ${reservationNumber}`,
    `Personas: ${partySize}`,
    ...(input.locationName ? [`Lugar: ${input.locationName}`] : []),
    ...(input.locationAddress ? [`Dirección: ${input.locationAddress}`] : []),
    ...(input.locationNotes ? [`Indicaciones: ${input.locationNotes}`] : []),
    `Abrir en Google Maps: ${locationUrl}`,
    closing,
  ].join("\n\n");

  return {
    subject,
    html: renderEmailLayout({ preheader: `${heading}. Esta es la ubicación.`, bodyHtml }),
    text,
  };
}
