import type { EventLifecycleStatus, EventPhase } from "@/domain/event/event-phase";

export type EventOperationErrorCode =
  | "EVENT_NOT_FOUND"
  | "SLUG_TAKEN"
  | "SLUG_LOCKED"
  | "MAX_PARTY_SIZE_ABOVE_CAPACITY"
  | "INVALID_WINDOW"
  | "INVALID_TRANSITION"
  | "CLOSES_AT_IN_PAST"
  | "CAPACITY_BELOW_ALLOCATED"
  | "CAPACITY_BELOW_MAX_PARTY_SIZE";

export type EventOperationResult<T> =
  { ok: true; value: T } | { ok: false; error: EventOperationErrorCode };

export interface EventRecord {
  id: string;
  internalName: string;
  slug: string;
  startsAt: Date;
  capacity: number;
  reservedSeats: number;
  maxPartySize: number;
  opensAt: Date;
  closesAt: Date;
  autoCloseOnFull: boolean;
  status: EventLifecycleStatus;
}

export interface CreateEventCommand {
  internalName: string;
  slug: string;
  startsAt: Date;
  opensAt: Date;
  closesAt: Date;
  capacity: number;
  maxPartySize: number;
  autoCloseOnFull: boolean;
  status: "DRAFT" | "SCHEDULED";
}

export interface UpdateEventCommand {
  id: string;
  internalName: string;
  slug: string;
  startsAt: Date;
  maxPartySize: number;
  opensAt: Date;
  closesAt: Date;
  autoCloseOnFull: boolean;
}

export interface AdminEventSummary extends EventRecord {
  phase: EventPhase;
  availableSeats: number;
  confirmedReservationCount: number;
}

export interface AdminEventDetail extends AdminEventSummary {
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseTimedResult<T> {
  databaseTime: Date;
  value: T;
}

export type ReservationStatus =
  "SUBMITTED" | "CONFIRMED" | "FULL_REJECTED" | "CANCELLED" | "EXPIRED";

export interface AdminReservationItem {
  id: string;
  reservationNumber: number | null;
  fullName: string;
  instagram: string;
  phone: string;
  email: string;
  partySize: number;
  status: ReservationStatus;
  submittedAt: Date;
  acceptedAt: Date | null;
  notes: string | null;
}

export type ReservationSortKey = "number" | "submittedAt" | "name";
export type SortDirection = "asc" | "desc";

export interface AdminReservationQuery {
  eventId: string;
  search?: string;
  status?: ReservationStatus;
  sort?: ReservationSortKey;
  direction?: SortDirection;
}

export interface AuditLogItem {
  id: bigint;
  occurredAt: Date;
  actorType: "ADMIN" | "PUBLIC" | "SYSTEM";
  actorAdminId: string | null;
  action:
    | "EVENT_CREATED"
    | "EVENT_UPDATED"
    | "EVENT_OPENED"
    | "EVENT_CLOSED"
    | "CAPACITY_CHANGED"
    | "RESERVATION_CREATED"
    | "RESERVATION_CANCELLED"
    | "ADMIN_SIGNED_IN"
    | "ADMIN_USER_CREATED"
    | "ADMIN_USER_UPDATED"
    | "ADMIN_USER_DEACTIVATED"
    | "ADMIN_USER_REACTIVATED"
    | "ADMIN_PASSWORD_RESET"
    | "ADMIN_PASSWORD_CHANGED"
    | "ADMIN_SESSIONS_REVOKED";
  entityType: "EVENT" | "RESERVATION" | "ADMIN_USER";
  entityId: string;
  metadata: Record<string, unknown>;
}

export interface AuditLogQuery {
  entityType?: AuditLogItem["entityType"];
  entityId?: string;
  eventId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedAuditLog {
  items: AuditLogItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PublicEvent {
  slug: string;
  startsAt: Date;
  phase: EventPhase;
  maxPartySize: number;
}
