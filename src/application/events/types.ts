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
  | "CAPACITY_BELOW_MAX_PARTY_SIZE"
  | "WAITLIST_CAPACITY_BELOW_WAITING";

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
  waitlistCapacity: number;
  waitlistedCount: number;
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
  waitlistCapacity: number;
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
  waitlistCapacity: number;
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

export type RosterView = "confirmadas" | "en-cola" | "rechazadas" | "canceladas" | "todas";
export type RosterStatus = "CONFIRMED" | "WAITING" | "REJECTED" | "CANCELLED" | "PROMOTED";
export type RosterEmailStatus = "PENDING" | "SENT" | "FAILED";

export interface EventRosterRow {
  kind: "RESERVATION" | "WAITLIST_ENTRY";
  id: string;
  status: RosterStatus;
  reservationNumber: number | null;
  queuePosition: number | null;
  fullName: string;
  instagram: string;
  phone: string;
  email: string;
  partySize: number;
  allergies: string | null;
  submittedAt: Date;
  emailStatus: RosterEmailStatus | null;
  emailSentAt: Date | null;
  emailLastError: string | null;
}

export type EventRosterCounts = Record<RosterView, number>;

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
    | "ADMIN_SESSIONS_REVOKED"
    | "ADMIN_USER_DELETION_REQUESTED"
    | "ADMIN_USER_DELETED"
    | "RESERVATION_WAITLISTED"
    | "WAITLIST_PROMOTED"
    | "WAITLIST_CANCELLED"
    | "ADMIN_PASSWORD_RESET_REQUESTED"
    | "ADMIN_PASSWORD_RESET_COMPLETED";
  entityType: "EVENT" | "RESERVATION" | "ADMIN_USER" | "WAITLIST_ENTRY";
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
