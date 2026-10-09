import type { Pool, PoolClient, QueryResultRow } from "pg";

import type { EventRepository } from "@/application/events/event-repository";
import type {
  AdminEventDetail,
  AdminEventSummary,
  AdminReservationItem,
  AdminReservationQuery,
  AuditLogItem,
  AuditLogQuery,
  CreateEventCommand,
  DatabaseTimedResult,
  EventOperationResult,
  EventOperationErrorCode,
  EventRecord,
  LoadedLocationVersion,
  EventRosterCounts,
  EventRosterRow,
  PaginatedAuditLog,
  PublicEvent,
  ReservationSortKey,
  RosterView,
  SortDirection,
  UpdateEventCommand,
} from "@/application/events/types";
import { canTransition } from "@/domain/event/event-lifecycle";
import {
  isEventLocationConfirmationValid,
  type EventLocationStatus,
} from "@/domain/event/event-location";
import { availableSeats, derivePhase, type EventLifecycleStatus } from "@/domain/event/event-phase";

import { pool as applicationPool } from "../client";
import { inTransaction as runInTransaction } from "../transaction";
import { queryEventRoster, queryEventRosterCounts } from "./event-roster-queries";
import { promoteWaitlist } from "./waitlist-promotion";

interface EventRow extends QueryResultRow {
  id: string;
  internal_name: string;
  slug: string;
  starts_at: Date;
  capacity: number;
  reserved_seats: number;
  max_party_size: number;
  opens_at: Date;
  closes_at: Date;
  auto_close_on_full: boolean;
  waitlist_capacity: number;
  waitlisted_count: number;
  status: EventLifecycleStatus;
  location_name: string | null;
  location_address: string | null;
  location_maps_url: string | null;
  location_notes: string | null;
  location_status: EventLocationStatus;
  location_confirmed_at: Date | null;
  location_revision: number;
  location_released_revision: number | null;
  location_latitude: number | null;
  location_longitude: number | null;
  created_at?: Date;
  updated_at?: Date;
  confirmed_reservation_count?: string;
  db_now?: Date;
}

interface ReservationRow extends QueryResultRow {
  id: string;
  reservation_number: number | null;
  full_name: string;
  instagram_handle: string;
  phone_e164: string;
  email: string;
  party_size: number;
  status: AdminReservationItem["status"];
  submitted_at: Date;
  accepted_at: Date | null;
  notes: string | null;
  db_now: Date;
}

interface PublicEventRow extends QueryResultRow {
  slug: string;
  starts_at: Date;
  max_party_size: number;
  status: EventLifecycleStatus;
  opens_at: Date;
  closes_at: Date;
  capacity: number;
  reserved_seats: number;
  waitlist_capacity: number;
  waitlisted_count: number;
  db_now: Date;
}

interface AuditRow extends QueryResultRow {
  id: string;
  occurred_at: Date;
  actor_type: AuditLogItem["actorType"];
  actor_admin_id: string | null;
  action: AuditLogItem["action"];
  entity_type: AuditLogItem["entityType"];
  entity_id: string;
  metadata: Record<string, unknown>;
  total_count: string;
  db_now: Date;
}

const eventColumns = `
  id,
  internal_name,
  slug,
  starts_at,
  capacity,
  reserved_seats,
  max_party_size,
  opens_at,
  closes_at,
  auto_close_on_full,
  waitlist_capacity,
  waitlisted_count,
  status,
  location_name,
  location_address,
  location_maps_url,
  location_notes,
  location_status,
  location_confirmed_at,
  location_revision,
  location_released_revision,
  location_latitude,
  location_longitude`;

function eventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    internalName: row.internal_name,
    slug: row.slug,
    startsAt: row.starts_at,
    capacity: row.capacity,
    reservedSeats: row.reserved_seats,
    maxPartySize: row.max_party_size,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    autoCloseOnFull: row.auto_close_on_full,
    waitlistCapacity: row.waitlist_capacity,
    waitlistedCount: row.waitlisted_count,
    status: row.status,
    location: {
      name: row.location_name,
      address: row.location_address,
      mapsUrl: row.location_maps_url,
      notes: row.location_notes,
      status: row.location_status,
      confirmedAt: row.location_confirmed_at,
      latitude: row.location_latitude,
      longitude: row.location_longitude,
    },
    locationRevision: row.location_revision,
    locationReleasedRevision: row.location_released_revision,
  };
}

function successful<T>(value: T): EventOperationResult<T> {
  return { ok: true, value };
}

function failed<T>(error: EventOperationErrorCode): EventOperationResult<T> {
  return { ok: false, error };
}

function isSlugViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "events_slug_uq"
  );
}

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  return runInTransaction(pool, ["SET LOCAL idle_in_transaction_session_timeout = '5s'"], work);
}

async function insertAudit(
  client: PoolClient,
  actorAdminId: string,
  action: AuditLogItem["action"],
  eventId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type,
       actor_admin_id,
       action,
       entity_type,
       entity_id,
       metadata
     )
     VALUES ('ADMIN', $1, $2, 'EVENT', $3, $4::jsonb)`,
    [actorAdminId, action, eventId, JSON.stringify(metadata)],
  );
}

async function lockEvent(client: PoolClient, id: string): Promise<EventRow | null> {
  const result = await client.query<EventRow>(
    `SELECT ${eventColumns}, clock_timestamp() AS db_now
       FROM events
      WHERE id = $1
      FOR UPDATE`,
    [id],
  );
  return result.rows[0] ?? null;
}

// Guards against a form loaded earlier restoring and re-confirming an outdated location.
function isLocationStale(locked: EventRow, expected: LoadedLocationVersion): boolean {
  return (
    locked.location_revision !== expected.revision || locked.location_status !== expected.status
  );
}

function comparableEvent(record: EventRecord): Record<string, unknown> {
  return {
    internalName: record.internalName,
    slug: record.slug,
    startsAt: record.startsAt.toISOString(),
    maxPartySize: record.maxPartySize,
    opensAt: record.opensAt.toISOString(),
    closesAt: record.closesAt.toISOString(),
    autoCloseOnFull: record.autoCloseOnFull,
    waitlistCapacity: record.waitlistCapacity,
    status: record.status,
    locationName: record.location.name,
    locationAddress: record.location.address,
    locationMapsUrl: record.location.mapsUrl,
    locationNotes: record.location.notes,
    locationStatus: record.location.status,
    locationConfirmedAt: record.location.confirmedAt?.toISOString() ?? null,
  };
}

function changedMetadata(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const changedFields = Object.keys(after).filter((field) => before[field] !== after[field]);
  // Notes can hold door codes and audit rows are append-only, so only the fact of change is kept.
  const loggedFields = changedFields.filter((field) => field !== "locationNotes");
  const metadata: Record<string, unknown> = {
    changedFields,
    before: Object.fromEntries(loggedFields.map((field) => [field, before[field]])),
    after: Object.fromEntries(loggedFields.map((field) => [field, after[field]])),
  };
  if (changedFields.includes("locationNotes")) {
    metadata.locationNotes = { changed: true };
  }
  return metadata;
}

const sortColumns: Record<ReservationSortKey, string> = {
  number: "reservation_number",
  submittedAt: "submitted_at",
  name: "full_name",
};

function reservationSort(sort: ReservationSortKey, direction: SortDirection): string {
  const column = sortColumns[sort] ?? sortColumns.submittedAt;
  const safeDirection = direction === "asc" ? "ASC" : "DESC";
  return `${column} ${safeDirection} NULLS LAST, submitted_at DESC, id ASC`;
}

export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export class PostgresEventRepository implements EventRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async create(
    command: CreateEventCommand,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>> {
    if (command.closesAt <= command.opensAt) {
      return failed("INVALID_WINDOW");
    }
    if (command.maxPartySize > command.capacity) {
      return failed("MAX_PARTY_SIZE_ABOVE_CAPACITY");
    }
    if (!isEventLocationConfirmationValid(command.location)) {
      return failed("LOCATION_CONFIRMATION_INCOMPLETE");
    }

    try {
      return await inTransaction(this.pool, async (client) => {
        const inserted = await client.query<EventRow>(
          `INSERT INTO events (
             internal_name,
             slug,
             starts_at,
             capacity,
             max_party_size,
             opens_at,
             closes_at,
             auto_close_on_full,
             waitlist_capacity,
             status,
             location_name,
             location_address,
             location_maps_url,
             location_notes,
             location_status,
             location_confirmed_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   $15::event_location_status,
                   CASE WHEN $15::event_location_status = 'CONFIRMED' THEN clock_timestamp() ELSE NULL END)
           RETURNING ${eventColumns}`,
          [
            command.internalName,
            command.slug,
            command.startsAt,
            command.capacity,
            command.maxPartySize,
            command.opensAt,
            command.closesAt,
            command.autoCloseOnFull,
            command.waitlistCapacity,
            command.status,
            command.location.name,
            command.location.address,
            command.location.mapsUrl,
            command.location.notes,
            command.location.status,
          ],
        );
        const created = eventRecord(inserted.rows[0]!);
        await insertAudit(client, actorAdminId, "EVENT_CREATED", created.id, {
          status: created.status,
        });
        return successful(created);
      });
    } catch (error) {
      if (isSlugViolation(error)) {
        return failed("SLUG_TAKEN");
      }
      throw error;
    }
  }

  async update(
    command: UpdateEventCommand,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>> {
    if (command.closesAt <= command.opensAt) {
      return failed("INVALID_WINDOW");
    }
    if (!isEventLocationConfirmationValid(command.location)) {
      return failed("LOCATION_CONFIRMATION_INCOMPLETE");
    }

    try {
      return await inTransaction(this.pool, async (client) => {
        const locked = await lockEvent(client, command.id);
        if (!locked) {
          return failed("EVENT_NOT_FOUND");
        }
        if (isLocationStale(locked, command.expectedLocation)) {
          return failed("LOCATION_CHANGED");
        }
        if (command.maxPartySize > locked.capacity) {
          return failed("MAX_PARTY_SIZE_ABOVE_CAPACITY");
        }
        if (command.slug !== locked.slug && locked.status !== "DRAFT") {
          return failed("SLUG_LOCKED");
        }
        if (command.waitlistCapacity < locked.waitlisted_count) {
          return failed("WAITLIST_CAPACITY_BELOW_WAITING");
        }

        const before = eventRecord(locked);
        const updated = await client.query<EventRow>(
          `UPDATE events
              SET internal_name = $2,
                  slug = $3,
                  starts_at = $4,
                  max_party_size = $5,
                  opens_at = $6,
                  closes_at = $7,
                  auto_close_on_full = $8,
                  waitlist_capacity = $9,
                  location_name = $10,
                  location_address = $11,
                  location_maps_url = $12,
                  location_notes = $13,
                  location_status = $14::event_location_status,
                  location_confirmed_at = CASE
                    WHEN $14::event_location_status = 'PENDING' THEN NULL
                    WHEN location_status = 'CONFIRMED' THEN location_confirmed_at
                    ELSE clock_timestamp()
                  END,
                  location_revision = location_revision + CASE WHEN
                    location_name IS DISTINCT FROM $10 OR
                    location_address IS DISTINCT FROM $11 OR
                    location_maps_url IS DISTINCT FROM $12 OR
                    location_notes IS DISTINCT FROM $13
                  THEN 1 ELSE 0 END,
                  location_released_revision = CASE
                    WHEN $14::event_location_status = 'PENDING' THEN NULL
                    ELSE location_released_revision
                  END,
                  updated_at = clock_timestamp()
            WHERE id = $1
            RETURNING ${eventColumns}`,
          [
            command.id,
            command.internalName,
            command.slug,
            command.startsAt,
            command.maxPartySize,
            command.opensAt,
            command.closesAt,
            command.autoCloseOnFull,
            command.waitlistCapacity,
            command.location.name,
            command.location.address,
            command.location.mapsUrl,
            command.location.notes,
            command.location.status,
          ],
        );
        const after = eventRecord(updated.rows[0]!);
        await insertAudit(
          client,
          actorAdminId,
          "EVENT_UPDATED",
          command.id,
          changedMetadata(comparableEvent(before), comparableEvent(after)),
        );
        return successful(after);
      });
    } catch (error) {
      if (isSlugViolation(error)) {
        return failed("SLUG_TAKEN");
      }
      throw error;
    }
  }

  async setLocationStatus(
    id: string,
    status: EventLocationStatus,
    expectedLocation: LoadedLocationVersion,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>> {
    return inTransaction(this.pool, async (client) => {
      const locked = await lockEvent(client, id);
      if (!locked) return failed("EVENT_NOT_FOUND");
      if (isLocationStale(locked, expectedLocation)) return failed("LOCATION_CHANGED");
      if (
        !isEventLocationConfirmationValid({
          address: locked.location_address,
          mapsUrl: locked.location_maps_url,
          status,
        })
      ) {
        return failed("LOCATION_CONFIRMATION_INCOMPLETE");
      }

      const before = eventRecord(locked);
      const updated = await client.query<EventRow>(
        `UPDATE events
            SET location_status = $2::event_location_status,
                location_confirmed_at = CASE
                  WHEN $2::event_location_status = 'PENDING' THEN NULL
                  WHEN location_status = 'CONFIRMED' THEN location_confirmed_at
                  ELSE clock_timestamp()
                END,
                location_released_revision = CASE
                  WHEN $2::event_location_status = 'PENDING' THEN NULL
                  ELSE location_released_revision
                END,
                updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING ${eventColumns}`,
        [id, status],
      );
      const after = eventRecord(updated.rows[0]!);
      await insertAudit(
        client,
        actorAdminId,
        "EVENT_UPDATED",
        id,
        changedMetadata(comparableEvent(before), comparableEvent(after)),
      );
      return successful(after);
    });
  }

  publish(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>> {
    return this.transition(id, "SCHEDULED", actorAdminId, "EVENT_UPDATED", ["DRAFT"]);
  }

  async openNow(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>> {
    return inTransaction(this.pool, async (client) => {
      const locked = await lockEvent(client, id);
      if (!locked) {
        return failed("EVENT_NOT_FOUND");
      }
      const allowed = locked.status === "SCHEDULED" || canTransition(locked.status, "SCHEDULED");
      if (!allowed) {
        return failed("INVALID_TRANSITION");
      }
      if (locked.closes_at <= locked.db_now!) {
        return failed("CLOSES_AT_IN_PAST");
      }

      const updated = await client.query<EventRow>(
        `UPDATE events
            SET status = 'SCHEDULED',
                opens_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING ${eventColumns}`,
        [id],
      );
      const after = eventRecord(updated.rows[0]!);
      await insertAudit(client, actorAdminId, "EVENT_OPENED", id, {});
      return successful(after);
    });
  }

  closeNow(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>> {
    return this.transition(id, "CLOSED", actorAdminId, "EVENT_CLOSED");
  }

  complete(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>> {
    return this.transition(id, "COMPLETED", actorAdminId, "EVENT_UPDATED");
  }

  cancel(id: string, actorAdminId: string): Promise<EventOperationResult<EventRecord>> {
    return this.transition(id, "CANCELLED", actorAdminId, "EVENT_UPDATED");
  }

  async changeCapacity(
    id: string,
    capacity: number,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>> {
    return inTransaction(this.pool, async (client) => {
      const locked = await lockEvent(client, id);
      if (!locked) {
        return failed("EVENT_NOT_FOUND");
      }
      if (capacity < locked.reserved_seats) {
        return failed("CAPACITY_BELOW_ALLOCATED");
      }
      if (capacity < locked.max_party_size) {
        return failed("CAPACITY_BELOW_MAX_PARTY_SIZE");
      }

      await client.query(
        `UPDATE events
            SET capacity = $2,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [id, capacity],
      );
      await insertAudit(client, actorAdminId, "CAPACITY_CHANGED", id, {
        from: locked.capacity,
        to: capacity,
      });
      await promoteWaitlist(client, id);
      const refreshed = await lockEvent(client, id);
      return successful(eventRecord(refreshed!));
    });
  }

  async changeWaitlistCapacity(
    id: string,
    waitlistCapacity: number,
    actorAdminId: string,
  ): Promise<EventOperationResult<EventRecord>> {
    return inTransaction(this.pool, async (client) => {
      const locked = await lockEvent(client, id);
      if (!locked) {
        return failed("EVENT_NOT_FOUND");
      }
      if (locked.status === "COMPLETED" || locked.status === "CANCELLED") {
        return failed("INVALID_TRANSITION");
      }
      if (waitlistCapacity < locked.waitlisted_count) {
        return failed("WAITLIST_CAPACITY_BELOW_WAITING");
      }

      const updated = await client.query<EventRow>(
        `UPDATE events
            SET waitlist_capacity = $2,
                updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING ${eventColumns}`,
        [id, waitlistCapacity],
      );
      await insertAudit(client, actorAdminId, "EVENT_UPDATED", id, {
        waitlistCapacity: { from: locked.waitlist_capacity, to: waitlistCapacity },
      });
      return successful(eventRecord(updated.rows[0]!));
    });
  }

  async listAdminEvents(): Promise<DatabaseTimedResult<AdminEventSummary[]>> {
    const result = await this.pool.query<EventRow>(
      `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
       SELECT e.*,
              db_clock.db_now,
              COUNT(r.id) FILTER (WHERE r.status = 'CONFIRMED') AS confirmed_reservation_count
         FROM events e
         CROSS JOIN db_clock
         LEFT JOIN reservations r ON r.event_id = e.id
        GROUP BY e.id, db_clock.db_now
        ORDER BY e.starts_at DESC, e.id`,
    );
    const databaseTime = result.rows[0]?.db_now ?? (await this.databaseTime());
    return {
      databaseTime,
      value: result.rows.map((row) => this.adminSummary(row, databaseTime)),
    };
  }

  async getAdminEvent(id: string): Promise<DatabaseTimedResult<AdminEventDetail | null>> {
    const result = await this.pool.query<EventRow>(
      `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
       SELECT e.*,
              db_clock.db_now,
              COUNT(r.id) FILTER (WHERE r.status = 'CONFIRMED') AS confirmed_reservation_count
         FROM events e
         CROSS JOIN db_clock
         LEFT JOIN reservations r ON r.event_id = e.id
        WHERE e.id = $1
        GROUP BY e.id, db_clock.db_now`,
      [id],
    );
    const row = result.rows[0];
    const databaseTime = row?.db_now ?? (await this.databaseTime());
    return {
      databaseTime,
      value: row
        ? {
            ...this.adminSummary(row, databaseTime),
            createdAt: row.created_at!,
            updatedAt: row.updated_at!,
          }
        : null,
    };
  }

  async listAdminReservations(
    query: AdminReservationQuery,
  ): Promise<DatabaseTimedResult<AdminReservationItem[]>> {
    const sort = query.sort ?? "submittedAt";
    const direction = query.direction ?? "desc";
    const values: unknown[] = [query.eventId];
    const conditions = ["r.event_id = $1"];

    if (query.search !== undefined && query.search !== "") {
      values.push(`%${escapeLikePattern(query.search)}%`);
      const parameter = `$${values.length}`;
      conditions.push(`(
        r.full_name ILIKE ${parameter} ESCAPE '\\'
        OR r.email ILIKE ${parameter} ESCAPE '\\'
        OR r.instagram_handle ILIKE ${parameter} ESCAPE '\\'
        OR r.phone_e164 ILIKE ${parameter} ESCAPE '\\'
      )`);
    }
    if (query.status) {
      values.push(query.status);
      conditions.push(`r.status = $${values.length}`);
    }

    const result = await this.pool.query<ReservationRow>(
      `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
       SELECT r.*, db_clock.db_now
         FROM reservations r
         CROSS JOIN db_clock
        WHERE ${conditions.join(" AND ")}
        ORDER BY ${reservationSort(sort, direction)}`,
      values,
    );
    const databaseTime = result.rows[0]?.db_now ?? (await this.databaseTime());
    return {
      databaseTime,
      value: result.rows.map((row) => ({
        id: row.id,
        reservationNumber: row.reservation_number,
        fullName: row.full_name,
        instagram: row.instagram_handle,
        phone: row.phone_e164,
        email: row.email,
        partySize: row.party_size,
        status: row.status,
        submittedAt: row.submitted_at,
        acceptedAt: row.accepted_at,
        notes: row.notes,
      })),
    };
  }

  async listEventRoster(
    eventId: string,
    view: RosterView,
  ): Promise<DatabaseTimedResult<EventRosterRow[]>> {
    const databaseTime = await this.databaseTime();
    return { databaseTime, value: await queryEventRoster(this.pool, eventId, view) };
  }

  countEventRoster(eventId: string): Promise<EventRosterCounts> {
    return queryEventRosterCounts(this.pool, eventId);
  }

  async listAuditLogs(query: AuditLogQuery): Promise<DatabaseTimedResult<PaginatedAuditLog>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.entityType) {
      values.push(query.entityType);
      conditions.push(`a.entity_type = $${values.length}`);
    }
    if (query.entityId) {
      values.push(query.entityId);
      conditions.push(`a.entity_id = $${values.length}`);
    }
    if (query.eventId) {
      values.push(query.eventId);
      conditions.push(`(
        (a.entity_type = 'EVENT' AND a.entity_id = $${values.length}::uuid)
        OR a.metadata ->> 'eventId' = $${values.length}::text
      )`);
    }
    values.push(pageSize, (page - 1) * pageSize);
    const limitParameter = `$${values.length - 1}`;
    const offsetParameter = `$${values.length}`;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await this.pool.query<AuditRow>(
      `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
       SELECT a.*,
              db_clock.db_now,
              COUNT(*) OVER () AS total_count
         FROM audit_logs a
         CROSS JOIN db_clock
         ${where}
        ORDER BY a.occurred_at DESC, a.id DESC
        LIMIT ${limitParameter}
       OFFSET ${offsetParameter}`,
      values,
    );
    const databaseTime = result.rows[0]?.db_now ?? (await this.databaseTime());
    return {
      databaseTime,
      value: {
        items: result.rows.map((row) => ({
          id: BigInt(row.id),
          occurredAt: row.occurred_at,
          actorType: row.actor_type,
          actorAdminId: row.actor_admin_id,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          metadata: row.metadata,
        })),
        page,
        pageSize,
        total: Number(result.rows[0]?.total_count ?? 0),
      },
    };
  }

  async getPublicHomeEvents(): Promise<DatabaseTimedResult<PublicEvent[]>> {
    const timed = await this.publicEvents();
    return {
      databaseTime: timed.databaseTime,
      value: timed.value.filter(
        (event) => event.phase === "OPEN" || event.phase === "WAITLIST" || event.phase === "FULL",
      ),
    };
  }

  async getPublicEventBySlug(slug: string): Promise<DatabaseTimedResult<PublicEvent | null>> {
    const timed = await this.publicEvents(slug);
    return { databaseTime: timed.databaseTime, value: timed.value[0] ?? null };
  }

  private async transition(
    id: string,
    to: EventLifecycleStatus,
    actorAdminId: string,
    action: "EVENT_UPDATED" | "EVENT_CLOSED",
    allowedFrom?: readonly EventLifecycleStatus[],
  ): Promise<EventOperationResult<EventRecord>> {
    return inTransaction(this.pool, async (client) => {
      const locked = await lockEvent(client, id);
      if (!locked) {
        return failed("EVENT_NOT_FOUND");
      }
      if (
        !canTransition(locked.status, to) ||
        (allowedFrom && !allowedFrom.includes(locked.status))
      ) {
        return failed("INVALID_TRANSITION");
      }

      const updated = await client.query<EventRow>(
        `UPDATE events
            SET status = $2,
                updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING ${eventColumns}`,
        [id, to],
      );
      const after = eventRecord(updated.rows[0]!);
      const metadata =
        action === "EVENT_UPDATED"
          ? { changedFields: ["status"], before: { status: locked.status }, after: { status: to } }
          : {};
      await insertAudit(client, actorAdminId, action, id, metadata);
      return successful(after);
    });
  }

  private adminSummary(row: EventRow, databaseTime: Date): AdminEventSummary {
    const record = eventRecord(row);
    return {
      ...record,
      phase: derivePhase(record, databaseTime),
      availableSeats: availableSeats(record),
      confirmedReservationCount: Number(row.confirmed_reservation_count ?? 0),
    };
  }

  private async databaseTime(): Promise<Date> {
    const result = await this.pool.query<{ db_now: Date }>("SELECT clock_timestamp() AS db_now");
    return result.rows[0]!.db_now;
  }

  private async publicEvents(slug?: string): Promise<DatabaseTimedResult<PublicEvent[]>> {
    const values = slug === undefined ? [] : [slug];
    const slugCondition = slug === undefined ? "" : "AND e.slug = $1";
    const result = await this.pool.query<PublicEventRow>(
      `WITH db_clock AS MATERIALIZED (SELECT clock_timestamp() AS db_now)
       SELECT e.slug,
              e.starts_at,
              e.max_party_size,
              e.status,
              e.opens_at,
              e.closes_at,
              e.capacity,
              e.reserved_seats,
              e.waitlist_capacity,
              e.waitlisted_count,
              db_clock.db_now
         FROM events e
         CROSS JOIN db_clock
        WHERE e.status <> 'DRAFT'
          ${slugCondition}
        ORDER BY e.starts_at, e.id`,
      values,
    );
    const databaseTime = result.rows[0]?.db_now ?? (await this.databaseTime());
    return {
      databaseTime,
      value: result.rows.map((row) => ({
        slug: row.slug,
        startsAt: row.starts_at,
        phase: derivePhase(
          {
            status: row.status,
            opensAt: row.opens_at,
            closesAt: row.closes_at,
            capacity: row.capacity,
            reservedSeats: row.reserved_seats,
            waitlistCapacity: row.waitlist_capacity,
            waitlistedCount: row.waitlisted_count,
          },
          databaseTime,
        ),
        maxPartySize: row.max_party_size,
      })),
    };
  }
}

export const postgresEventRepository = new PostgresEventRepository();
