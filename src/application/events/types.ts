import type { EventLifecycleStatus, EventPhase } from "@/domain/event/event-phase";
import type { EventLocationStatus, MapsCoordinates } from "@/domain/event/event-location";
import type { RequestGuest } from "@/domain/reservation/request-guests";

export type EventOperationErrorCode =
  | "EVENT_NOT_FOUND"
  | "SLUG_TAKEN"
  | "SLUG_LOCKED"
  | "MAX_PARTY_SIZE_NOT_ALLOWED"
  | "MAX_PARTY_SIZE_ABOVE_CAPACITY"
  | "INVALID_WINDOW"
  | "INVALID_TRANSITION"
  | "CLOSES_AT_IN_PAST"
  | "CLOSES_AFTER_START"
  | "CAPACITY_BELOW_ALLOCATED"
  | "CAPACITY_BELOW_MAX_PARTY_SIZE"
  | "WAITLIST_CAPACITY_BELOW_WAITING"
  | "EVENT_ACCEPTING_RESERVATIONS"
  | "LOCATION_CONFIRMATION_INCOMPLETE"
  | "LOCATION_CHANGED";

export interface EventLocation {
  name: string | null;
  address: string | null;
  mapsUrl: string | null;
  notes: string | null;
  status: EventLocationStatus;
}

export interface EventLocationRecord extends EventLocation {
  confirmedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
}

export interface LoadedLocationVersion {
  revision: number;
  status: EventLocationStatus;
}

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
  paymentInstructions: string | null;
  priceCents: number | null;
  status: EventLifecycleStatus;
  location: EventLocationRecord;
  locationRevision: number;
  locationReleasedRevision: number | null;
}

export interface CancelledEventRecord extends EventRecord {
  cancelledReservations: number;
  refundsPending: number;
  cancelledEntries: number;
  messageIds: string[];
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
  paymentInstructions?: string | null;
  priceCents?: number | null;
  status: "DRAFT" | "SCHEDULED";
  location: EventLocation;
  coordinates: MapsCoordinates | null;
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
  paymentInstructions?: string | null;
  // Undefined keeps the stored price: an event that has one cannot go back to having none.
  priceCents?: number;
  location: EventLocation;
  keepMapsUrl: boolean;
  // Null for an unchanged link keeps the stored point, so a failed lookup never erases it.
  coordinates: MapsCoordinates | null;
  expectedLocation: LoadedLocationVersion;
}

export interface AdminEventSummary extends EventRecord {
  phase: EventPhase;
  availableSeats: number;
  confirmedReservationCount: number;
  inReviewCount: number;
  onListCount: number;
  paidCount: number;
  queueCount: number;
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
  guests: RequestGuest[];
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
    | "ADMIN_SESSIONS_REVOKED"
    | "ADMIN_USER_DELETION_REQUESTED"
    | "ADMIN_USER_DELETED"
    | "RESERVATION_WAITLISTED"
    | "WAITLIST_PROMOTED"
    | "WAITLIST_CANCELLED"
    | "ADMIN_PASSWORD_RESET_REQUESTED"
    | "ADMIN_PASSWORD_RESET_COMPLETED"
    | "EVENT_DELETED"
    | "DRINK_CREATED"
    | "DRINK_UPDATED"
    | "DRINK_DELETED"
    | "RESERVATION_ON_LIST"
    | "RESERVATION_PAID"
    | "RESERVATION_REJECTED"
    | "RESERVATION_REFUNDED"
    | "RESERVATION_UPDATED"
    | "WAITLIST_UPDATED"
    | "WAITLIST_REORDERED"
    | "MESSAGE_TEMPLATE_UPDATED"
    | "MESSAGING_CONTACT_LINKED"
    | "INSTAGRAM_CONNECTED"
    | "INSTAGRAM_DISCONNECTED"
    | "PAYMENT_SETTINGS_UPDATED";
  entityType:
    | "EVENT"
    | "RESERVATION"
    | "ADMIN_USER"
    | "WAITLIST_ENTRY"
    | "DRINK"
    | "MESSAGE_TEMPLATE"
    | "MESSAGING_CONTACT"
    | "INSTAGRAM_CONNECTION"
    | "PAYMENT_SETTINGS";
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
  opensAt: Date;
  phase: EventPhase;
  maxPartySize: number;
}
