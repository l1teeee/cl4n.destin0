import type {
  AdminEventSummary,
  AuditLogItem,
  EventLocationRecord,
  ReservationSortKey,
  ReservationStatus,
  SortDirection,
} from "@/application/events/types";
import {
  emailOutboxKinds,
  type EmailOutboxKind,
  type EmailOutboxStatus,
} from "@/application/notifications/email-outbox";
import type { AdminRole } from "@/domain/admin/admin-access";
import { canDeleteEvent } from "@/domain/event/event-lifecycle";
import type { EventPhase } from "@/domain/event/event-phase";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
import type { BadgeVariant } from "@/ui/primitives/badge";

export type DashboardAction = "OPEN_NOW" | "CLOSE_NOW" | "EDIT" | "RESERVATIONS" | "DELETE";
export type LifecycleAction = "PUBLISH" | "OPEN_NOW" | "CLOSE_NOW" | "COMPLETE" | "CANCEL";

export interface ReservationSearchParams {
  q?: string;
  status?: ReservationStatus;
  sort: ReservationSortKey;
  direction: SortDirection;
}

const reservationStatuses = new Set<ReservationStatus>([
  "SUBMITTED",
  "CONFIRMED",
  "FULL_REJECTED",
  "CANCELLED",
  "EXPIRED",
]);
const reservationSortKeys = new Set<ReservationSortKey>(["number", "submittedAt", "name"]);
const auditEntityTypes = new Set<AuditLogItem["entityType"]>([
  "EVENT",
  "RESERVATION",
  "ADMIN_USER",
  "WAITLIST_ENTRY",
  "DRINK",
  "MESSAGE_TEMPLATE",
  "MESSAGING_CONTACT",
  "INSTAGRAM_CONNECTION",
]);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function dashboardActions(event: AdminEventSummary, databaseTime: Date): DashboardAction[] {
  const actions: DashboardAction[] = [];
  if (
    (event.status === "DRAFT" || event.status === "SCHEDULED" || event.status === "CLOSED") &&
    event.closesAt > databaseTime &&
    event.phase !== "OPEN" &&
    event.phase !== "WAITLIST" &&
    event.phase !== "FULL"
  ) {
    actions.push("OPEN_NOW");
  }
  if (
    event.status === "SCHEDULED" &&
    (event.phase === "OPEN" || event.phase === "WAITLIST" || event.phase === "FULL")
  ) {
    actions.push("CLOSE_NOW");
  }
  actions.push("EDIT", "RESERVATIONS");
  if (canDeleteEvent(event.phase)) {
    actions.push("DELETE");
  }
  return actions;
}

export function lifecycleActions(event: AdminEventSummary, databaseTime: Date): LifecycleAction[] {
  if (event.status === "COMPLETED" || event.status === "CANCELLED") {
    return [];
  }

  const actions: LifecycleAction[] = [];
  if (event.status === "DRAFT") {
    actions.push("PUBLISH");
  }
  if (
    (event.status === "DRAFT" || event.status === "SCHEDULED" || event.status === "CLOSED") &&
    event.closesAt > databaseTime &&
    event.phase !== "OPEN" &&
    event.phase !== "WAITLIST" &&
    event.phase !== "FULL"
  ) {
    actions.push("OPEN_NOW");
  }
  if (
    event.status === "SCHEDULED" &&
    (event.phase === "OPEN" || event.phase === "WAITLIST" || event.phase === "FULL")
  ) {
    actions.push("CLOSE_NOW");
  }
  if (event.status === "CLOSED") {
    actions.push("COMPLETE");
  }
  actions.push("CANCEL");
  return actions;
}

export function formatAdminDate(date: Date | null): string {
  return date ? formatUtcForElSalvador(date, "dd/MM/yyyy HH:mm") : "-";
}

export function formatReservationNumber(number: number | null): string {
  return number === null ? "-" : `#${String(number).padStart(3, "0")}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("es-SV").format(value);
}

export function formatAuditMetadata(metadata: Record<string, unknown>): string {
  if (typeof metadata.clueAdded === "string") {
    return `Pista publicada: ${metadata.clueAdded}`;
  }
  if (typeof metadata.clueRemoved === "string") {
    return `Pista eliminada: ${metadata.clueRemoved}`;
  }
  if (typeof metadata.imageAdded === "string") {
    return `Imagen agregada: ${metadata.imageAdded} (${String(metadata.contentType)}, ${String(metadata.byteSize)} bytes)`;
  }
  if (typeof metadata.imageRemoved === "string") {
    return `Imagen eliminada: ${metadata.imageRemoved}`;
  }
  if (
    typeof metadata.locationMessagesQueued === "number" &&
    typeof metadata.locationRevision === "number"
  ) {
    const count = metadata.locationMessagesQueued;
    return count > 0
      ? `Ubicación enviada (versión ${metadata.locationRevision}) a ${count} ${count === 1 ? "persona" : "personas"}`
      : `Ubicación (versión ${metadata.locationRevision}): nadie pendiente de recibirla`;
  }
  if (typeof metadata.stage === "string") {
    const labels: Record<string, string> = {
      IN_REVIEW: "Por revisar",
      ON_LIST: "En la lista",
      PAID: "Pago verificado",
    };
    const size = metadata.partySize;
    return `Etapa: ${labels[metadata.stage] ?? metadata.stage}${typeof size === "number" ? ` · ${size} ${size === 1 ? "persona" : "personas"}` : ""}`;
  }
  if (
    Array.isArray(metadata.changedFields) &&
    metadata.changedFields.every((value) => typeof value === "string")
  ) {
    return `Campos cambiados: ${metadata.changedFields.join(", ")}`;
  }
  const fields = Object.entries(metadata)
    .filter(([key]) => !key.endsWith("Id"))
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  return fields.length ? fields.join(" · ") : "-";
}

export function adminRoleLabel(role: AdminRole): string {
  return role === "SUPER_ADMIN" ? "Superadministrador" : "Administrador";
}

export function adminStatusLabel(isActive: boolean): string {
  return isActive ? "Activo" : "Inactivo";
}

export function adminStatusBadgeVariant(status: EventPhase | "ACTIVE" | "INACTIVE"): BadgeVariant {
  const variants: Record<EventPhase | "ACTIVE" | "INACTIVE", BadgeVariant> = {
    ACTIVE: "active",
    CANCELLED: "cancelled",
    CLOSED: "closed",
    COMPLETED: "default",
    DRAFT: "draft",
    FULL: "default",
    INACTIVE: "inactive",
    OPEN: "open",
    SCHEDULED: "default",
    WAITLIST: "waitlist",
  };
  return variants[status];
}

export function eventPhaseLabel(phase: EventPhase): string {
  return phase === "WAITLIST" ? "Solo cola" : phase;
}

export function publicEventUrl(appBaseUrl: string, slug: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/solicitar/${encodeURIComponent(slug)}`;
}

export function publicCluesUrl(appBaseUrl: string, slug: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/pistas/${encodeURIComponent(slug)}`;
}

export function publicLinkHint(phase: EventPhase): string | null {
  switch (phase) {
    case "DRAFT":
      return "Borrador: el enlace no funciona hasta que publiques la experiencia.";
    case "SCHEDULED":
      return "El enlace mostrará el formulario cerrado hasta que abra.";
    case "OPEN":
    case "WAITLIST":
      return null;
    case "FULL":
      return "Sin cupos: el enlace mostrará que no hay lugares.";
    case "CLOSED":
    case "COMPLETED":
    case "CANCELLED":
      return "El formulario ya cerró: el enlace mostrará el estado cerrado.";
  }
}

export function editEventBackLink(
  eventId: string,
  from: string | string[] | undefined,
): { href: string; label: string } {
  if (first(from) === "experiencias") {
    return { href: "/admin", label: "Volver a experiencias" };
  }
  return { href: `/admin/events/${eventId}`, label: "Volver al detalle" };
}

export function reservationStatusLabel(status: ReservationStatus): string {
  const labels: Record<ReservationStatus, string> = {
    SUBMITTED: "Enviada",
    CONFIRMED: "Confirmada",
    FULL_REJECTED: "Rechazada por capacidad",
    CANCELLED: "Cancelada",
    EXPIRED: "Expirada",
  };
  return labels[status];
}

export function parseReservationSearchParams(
  params: Record<string, string | string[] | undefined>,
): ReservationSearchParams {
  const rawQuery = first(params.q)?.trim();
  const rawStatus = first(params.status);
  const rawSort = first(params.sort);
  const rawDirection = first(params.dir);

  return {
    ...(rawQuery ? { q: rawQuery.slice(0, 120) } : {}),
    ...(reservationStatuses.has(rawStatus as ReservationStatus)
      ? { status: rawStatus as ReservationStatus }
      : {}),
    sort: reservationSortKeys.has(rawSort as ReservationSortKey)
      ? (rawSort as ReservationSortKey)
      : "submittedAt",
    direction: rawDirection === "asc" ? "asc" : "desc",
  };
}

export function parseAuditSearchParams(params: Record<string, string | string[] | undefined>): {
  entityType?: AuditLogItem["entityType"];
  page: number;
} {
  const rawEntityType = first(params.entityType);
  const rawPage = Number(first(params.page));
  return {
    ...(auditEntityTypes.has(rawEntityType as AuditLogItem["entityType"])
      ? { entityType: rawEntityType as AuditLogItem["entityType"] }
      : {}),
    page: Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

const AUDIT_PAGE_SIZE_MOBILE = 5;
const AUDIT_PAGE_SIZE_DESKTOP = 10;

export function auditPageSizeFor(deviceType: string | undefined): number {
  return deviceType === "mobile" ? AUDIT_PAGE_SIZE_MOBILE : AUDIT_PAGE_SIZE_DESKTOP;
}

export type EventSection =
  "invitados" | "pistas" | "economia" | "ubicacion" | "gestion" | "auditoria";

export function parseEventSection(
  value: string | string[] | undefined,
  cluesVisible: boolean,
): EventSection {
  const raw = first(value);
  // "reservaciones" is the id this section had before the guest list replaced it.
  if (raw === "reservaciones") return "invitados";
  if (raw === "economia" || raw === "ubicacion" || raw === "gestion" || raw === "auditoria") {
    return raw;
  }
  if (raw === "pistas" && cluesVisible) return "pistas";
  return "invitados";
}

export function eventSections(cluesVisible: boolean): { id: EventSection; label: string }[] {
  return [
    { id: "invitados", label: "Invitados" },
    ...(cluesVisible ? [{ id: "pistas" as const, label: "Pistas" }] : []),
    { id: "economia", label: "Economía" },
    { id: "ubicacion", label: "Ubicación" },
    { id: "gestion", label: "Gestión" },
    { id: "auditoria", label: "Auditoría" },
  ];
}

export const dashboardGuestColumns: readonly {
  heading: string;
  value: (event: AdminEventSummary) => string;
}[] = [
  {
    heading: "Ocupados",
    value: (event) => `${formatCount(event.reservedSeats)}/${formatCount(event.capacity)}`,
  },
  { heading: "Por revisar", value: (event) => formatCount(event.inReviewCount) },
  { heading: "En la lista", value: (event) => formatCount(event.onListCount) },
  { heading: "Confirmados", value: (event) => formatCount(event.paidCount) },
  {
    heading: "Cola",
    value: (event) => `${formatCount(event.queueCount)} / ${formatCount(event.waitlistCapacity)}`,
  },
];

export function emailStatusLabel(status: EmailOutboxStatus): string {
  const labels: Record<EmailOutboxStatus, string> = {
    SENT: "Enviado",
    PENDING: "Pendiente",
    FAILED: "Falló",
  };
  return labels[status];
}

export function emailStatusBadgeVariant(status: EmailOutboxStatus): BadgeVariant {
  const badgeStatus: Record<EmailOutboxStatus, BadgeVariant> = {
    PENDING: "draft",
    SENT: "confirmed",
    FAILED: "rejected",
  };
  return badgeStatus[status];
}

export function emailKindLabel(kind: EmailOutboxKind): string {
  const labels: Record<EmailOutboxKind, string> = {
    RESERVATION_CONFIRMED: "Confirmación de reserva",
    RESERVATION_WAITLISTED: "Entrada a la cola",
    WAITLIST_PROMOTED: "Promoción desde la cola",
    RESERVATION_CANCELLED: "Reserva cancelada",
    WAITLIST_CANCELLED: "Retiro de la cola",
    EVENT_LOCATION: "Ubicación del evento",
    ADMIN_ADDED: "Alta de administrador",
    ADMIN_SIGNED_IN: "Inicio de sesión",
    ADMIN_PASSWORD_RESET_BY_ADMIN: "Contraseña restablecida por un administrador",
    ADMIN_PASSWORD_CHANGED: "Cambio de contraseña",
    ADMIN_PASSWORD_RESET_COMPLETED: "Recuperación de contraseña",
    ADMIN_DEACTIVATED: "Cuenta desactivada",
    ADMIN_REACTIVATED: "Cuenta reactivada",
    ADMIN_ROLE_CHANGED: "Cambio de rol",
    ADMIN_DELETED: "Cuenta eliminada",
    ADMIN_SESSIONS_REVOKED: "Sesiones cerradas",
  };
  return labels[kind];
}

export function emailErrorLabel(error: string | null): string {
  if (error === null) return "-";
  const labels: Record<string, string> = {
    RESERVATION_NOT_CONFIRMED: "La reserva ya no está confirmada",
    LOCATION_NOT_CONFIRMED: "La ubicación ya no está confirmada",
    LOCATION_SUPERSEDED: "Existe una ubicación más reciente",
    KIND_RETIRED: "Los avisos a invitados ahora se envían por Instagram",
  };
  return labels[error] ?? error;
}

export const emailStatusFilters: readonly {
  status: EmailOutboxStatus | undefined;
  label: string;
}[] = [
  { status: undefined, label: "Todos" },
  { status: "PENDING", label: "Pendientes" },
  { status: "SENT", label: "Enviados" },
  { status: "FAILED", label: "Fallidos" },
];

export function parseEmailLogSearchParams(params: Record<string, string | string[] | undefined>): {
  status?: EmailOutboxStatus;
  kind?: EmailOutboxKind;
} {
  const rawStatus = first(params.estado);
  const rawKind = first(params.tipo);
  const status = emailStatusFilters.find((entry) => entry.status === rawStatus)?.status;
  const kind = emailOutboxKinds.find((entry) => entry === rawKind);
  return {
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
  };
}

export interface LocationMap {
  src: string;
  caption: string;
}

export function locationMap(
  location: Pick<EventLocationRecord, "name" | "address" | "latitude" | "longitude">,
): LocationMap | null {
  if (location.latitude !== null && location.longitude !== null) {
    return {
      src: `https://www.google.com/maps?q=${location.latitude},${location.longitude}&z=17&output=embed`,
      caption: "Punto exacto del enlace de Google Maps.",
    };
  }
  if (location.address === null) return null;

  const query = location.name ? `${location.name}, ${location.address}` : location.address;
  return {
    src: `https://www.google.com/maps?q=${encodeURIComponent(query.replace(/\r?\n/g, ", "))}&output=embed`,
    caption:
      "Ubicación aproximada según la dirección. Pega un enlace de Google Maps para marcar el punto exacto.",
  };
}
