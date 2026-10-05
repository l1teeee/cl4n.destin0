import type {
  AdminEventDetail,
  AdminEventSummary,
  AdminReservationItem,
  AdminReservationQuery,
  AuditLogQuery,
  CreateEventCommand,
  DatabaseTimedResult,
  EventOperationResult,
  EventRecord,
  PaginatedAuditLog,
  PublicEvent,
  UpdateEventCommand,
} from "./types";

export interface EventRepository {
  create(
    command: CreateEventCommand,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>>;
  update(
    command: UpdateEventCommand,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>>;
  publish(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>>;
  openNow(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>>;
  closeNow(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>>;
  complete(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>>;
  cancel(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>>;
  changeCapacity(
    id: string,
    capacity: number,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>>;
  listAdminEvents(): Promise<DatabaseTimedResult<AdminEventSummary[]>>;
  getAdminEvent(id: string): Promise<DatabaseTimedResult<AdminEventDetail | null>>;
  listAdminReservations(
    query: AdminReservationQuery,
  ): Promise<DatabaseTimedResult<AdminReservationItem[]>>;
  listAuditLogs(query: AuditLogQuery): Promise<DatabaseTimedResult<PaginatedAuditLog>>;
  getPublicHomeEvents(): Promise<DatabaseTimedResult<PublicEvent[]>>;
  getPublicEventBySlug(slug: string): Promise<DatabaseTimedResult<PublicEvent | null>>;
}
