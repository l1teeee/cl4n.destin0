import { getAdminEventDetail } from "@/application/events/event-use-cases";
import type { EventGuestView } from "@/application/guests/guest-views";
import { adminGuestIdSchema, eventGuestViewSchema } from "@/contracts/admin-guest";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { listEventGuests } from "@/infrastructure/db/repositories/event-guest-queries";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { createCsv } from "@/infrastructure/http/csv";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
import { formatReservationNumber } from "@/ui/admin/view-model";

function timestamp(value: Date | null): string {
  return value ? formatUtcForElSalvador(value, "dd/MM/yyyy HH:mm") : "";
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    CONFIRMED: "Con lugar",
    WAITING: "En cola",
    CANCELLED: "Descartada",
    FULL_REJECTED: "Sin lugar",
  };
  return labels[status] ?? status;
}

function stageLabel(stage: string | null): string {
  if (stage === "IN_REVIEW") return "Por revisar";
  if (stage === "ON_LIST") return "En la lista";
  if (stage === "PAID") return "Confirmado";
  return "";
}

function refundLabel(status: string | null): string {
  if (status === "PENDING") return "Pendiente";
  if (status === "REFUNDED") return "Reembolsado";
  return "";
}

function exportView(value: string | null): EventGuestView {
  const parsed = eventGuestViewSchema.safeParse(value ?? "todas");
  return parsed.success ? parsed.data : "todas";
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
  if (!adminGuestIdSchema.safeParse(id).success) {
    return new Response("Experiencia no encontrada", { status: 404 });
  }
  const view = exportView(new URL(request.url).searchParams.get("vista"));
  const [eventResult, guests] = await Promise.all([
    getAdminEventDetail(postgresEventRepository, id),
    listEventGuests(id, view),
  ]);
  if (!eventResult.value) {
    return new Response("Experiencia no encontrada", { status: 404 });
  }

  const csv = createCsv([
    [
      "Número",
      "Estado",
      "Etapa",
      "Invitado 1",
      "Instagram 1",
      "Invitado 2",
      "Instagram 2",
      "Personas",
      "Alergias",
      "Observaciones",
      "Recibida",
      "En la lista",
      "Pagado",
      "Reembolso",
      "Contacto de Instagram",
    ],
    ...guests.map((guest) => [
      guest.kind === "RESERVATION" && guest.number !== null
        ? formatReservationNumber(guest.number)
        : guest.position === null
          ? ""
          : `#${guest.position}`,
      statusLabel(guest.status),
      stageLabel(guest.stage),
      guest.guest1Name,
      guest.guest1Instagram,
      guest.guest2Name ?? "",
      guest.guest2Instagram ?? "",
      guest.partySize,
      guest.allergies ?? "",
      guest.notes ?? "",
      timestamp(guest.submittedAt),
      timestamp(guest.onListAt),
      timestamp(guest.paidAt),
      refundLabel(guest.refundStatus),
      guest.contactUsername ?? "",
    ]),
  ]);
  const date = formatUtcForElSalvador(eventResult.databaseTime, "yyyyMMdd");
  const filename = `clandestino-${eventResult.value.slug}-${view}-${date}.csv`;
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
