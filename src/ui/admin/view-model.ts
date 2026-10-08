import type {
  AdminEventSummary,
  AuditLogItem,
  ReservationSortKey,
  ReservationStatus,
  SortDirection,
} from "@/application/events/types";
import type { AdminRole } from "@/domain/admin/admin-access";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";

export type DashboardAction = "OPEN_NOW" | "CLOSE_NOW" | "EDIT" | "RESERVATIONS";
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
    event.phase !== "FULL"
  ) {
    actions.push("OPEN_NOW");
  }
  if (event.status === "SCHEDULED" && (event.phase === "OPEN" || event.phase === "FULL")) {
    actions.push("CLOSE_NOW");
  }
  actions.push("EDIT", "RESERVATIONS");
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
    event.phase !== "FULL"
  ) {
    actions.push("OPEN_NOW");
  }
  if (event.status === "SCHEDULED" && event.phase !== "SCHEDULED") {
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

export function adminRoleLabel(role: AdminRole): string {
  return role === "SUPER_ADMIN" ? "Superadministrador" : "Administrador";
}

export function adminStatusLabel(isActive: boolean): string {
  return isActive ? "Activo" : "Inactivo";
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
