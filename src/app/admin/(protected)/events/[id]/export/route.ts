import { getAdminEventDetail, getEventRoster } from "@/application/events/event-use-cases";
import type { EventRosterRow, RosterView } from "@/application/events/types";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
import { createCsv } from "@/infrastructure/http/csv";
import {
  formatReservationNumber,
  parseRosterView,
  rosterLocationCell,
  rosterStatusLabel,
} from "@/ui/admin/view-model";

function emailDelivery(row: EventRosterRow): string {
  if (row.emailStatus === "SENT") return "Enviado";
  if (row.emailStatus === "PENDING") return "Pendiente";
  if (row.emailStatus === "FAILED") return "Fallo";
  return "";
}

function rosterCsv(rows: EventRosterRow[]): string {
  return createCsv([
    [
      "Estado",
      "Número",
      "Posición en cola",
      "Nombre",
      "Instagram",
      "Teléfono",
      "Email",
      "Personas",
      "Alergias",
      "Recibida",
      "Correo",
      "Correo enviado",
      "Ubicación",
    ],
    ...rows.map((row) => [
      rosterStatusLabel(row.status),
      row.reservationNumber === null ? "" : formatReservationNumber(row.reservationNumber),
      row.queuePosition === null ? "" : `#${row.queuePosition}`,
      row.fullName,
      row.instagram,
      row.phone,
      row.email,
      row.partySize,
      row.allergies ?? "",
      formatUtcForElSalvador(row.submittedAt, "dd/MM/yyyy HH:mm"),
      emailDelivery(row),
      row.emailSentAt ? formatUtcForElSalvador(row.emailSentAt, "dd/MM/yyyy HH:mm") : "",
      row.kind === "RESERVATION" ? rosterLocationCell(row).text : "",
    ]),
  ]);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) {
    return new Response("No autorizado", { status: 401 });
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const view: RosterView = parseRosterView(url.searchParams.get("vista") ?? undefined, "todas");
  const [eventResult, roster] = await Promise.all([
    getAdminEventDetail(postgresEventRepository, id),
    getEventRoster(postgresEventRepository, id, view),
  ]);
  if (!eventResult.value) {
    return new Response("Experiencia no encontrada", { status: 404 });
  }

  const date = formatUtcForElSalvador(eventResult.databaseTime, "yyyyMMdd");
  const filename = `clandestino-${eventResult.value.slug}-${view}-${date}.csv`;
  return new Response(`\uFEFF${rosterCsv(roster.value)}`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
