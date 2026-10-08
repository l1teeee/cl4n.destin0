import { es } from "date-fns/locale";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
import { emailDetailRow, emailHeading, emailParagraph } from "./email-blocks";
import { renderEmailLayout } from "./email-layout";
import type { RenderedEmail } from "./rendered-email";

export function adminSignInAlertEmail(input: {
  displayName: string;
  occurredAt: Date;
  ipAddress: string | null;
}): RenderedEmail {
  const subject = "Nuevo inicio de sesión en Clandestino";
  const preheader = "Se inició sesión en tu cuenta.";
  const heading = "Nuevo inicio de sesión";
  const intro = `${input.displayName}, se inició sesión en tu cuenta de administración.`;
  const localTime = formatUtcForElSalvador(input.occurredAt, "d 'de' MMMM yyyy, HH:mm", es);
  const signInTime = `${localTime} (hora de El Salvador)`;
  const ipAddress = input.ipAddress ?? "No disponible";
  const warning =
    "Si no fuiste tú, cambia tu contraseña de inmediato y pide a un super administrador que cierre tus sesiones.";

  const bodyHtml = [
    emailHeading(heading),
    emailParagraph(intro),
    emailDetailRow("Fecha", signInTime),
    emailDetailRow("IP", ipAddress),
    emailParagraph(warning),
  ].join("\n");

  const text = [heading, intro, `Fecha: ${signInTime}`, `IP: ${ipAddress}`, warning].join("\n\n");

  return { subject, html: renderEmailLayout({ preheader, bodyHtml }), text };
}
