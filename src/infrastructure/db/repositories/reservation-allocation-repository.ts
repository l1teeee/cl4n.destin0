import type { Pool, PoolClient } from "pg";

import type {
  AllocationCommand,
  AllocationOutcome,
  AllocationResult,
  CancelReservationCommand,
  CancelReservationOutcome,
  CancelWaitlistEntryCommand,
  CancelWaitlistEntryOutcome,
  CompletedIdempotencyRecord,
  ImportAllocationCommand,
  ReservationAllocationRepository,
  ReservationResponse,
} from "@/application/ports/reservation-allocation-repository";
import { renderMessageTemplate } from "@/domain/messaging/message-template";
import {
  classifyAllocationFailure,
  classifyImportAllocationFailure,
} from "@/domain/reservation/allocation-failure";
import { firstName } from "@/domain/reservation/guest-names";
import { guestFirstNames } from "@/domain/reservation/request-guests";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

import { pool as applicationPool } from "../client";
import { retryableDatabaseErrorCode } from "../retryable-database-error";
import { enqueueGuestMessage } from "./guest-messages";
import { promoteWaitlist } from "./waitlist-promotion";

interface DatabaseError {
  code?: string;
  constraint?: string;
}

class DuplicateUnderEventLockError extends Error {}

// The unique index of each table cannot see the other table, but promoting a waitlist entry
// copies its link code into a new reservation. Each public insert therefore also checks that
// the code is unused in the other table and throws this error when it is taken.
class LinkCodeCollisionError extends Error {}

interface EventRow {
  id: string;
  status: "DRAFT" | "SCHEDULED" | "CLOSED" | "COMPLETED" | "CANCELLED";
  starts_at: Date;
  opens_at: Date;
  closes_at: Date;
  capacity: number;
  reserved_seats: number;
  max_party_size: number;
  database_now?: Date;
}

type SharedAllocationCommand = Omit<AllocationCommand, "eventSlug">;

interface AllocationPolicy {
  eventColumn: "slug" | "id";
  eventSelector: string;
  imported?: { adminId: string; importId: string; rowNumber: number };
}

function allocationWindow(policy: AllocationPolicy): string {
  return policy.imported
    ? "status IN ('SCHEDULED', 'CLOSED') AND starts_at > clock_timestamp()"
    : "status = 'SCHEDULED' AND opens_at <= clock_timestamp() AND closes_at > clock_timestamp()";
}

function importAuditMetadata(policy: AllocationPolicy): Record<string, unknown> {
  if (!policy.imported) return {};
  return {
    source: "IMPORT",
    importId: policy.imported.importId,
    rowNumber: policy.imported.rowNumber,
  };
}

interface CompletedRecordRow {
  request_fingerprint: string;
  response_status: number;
  response_body: Record<string, unknown>;
}

interface AcquiredEventRow {
  last_reservation_number: number;
  status: EventRow["status"];
  accepted_at: Date;
}

const linkCodeConstraints = new Set(["reservations_link_code_uq", "waitlist_entries_link_code_uq"]);

function databaseError(error: unknown): DatabaseError {
  return typeof error === "object" && error !== null ? (error as DatabaseError) : {};
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK");
}

interface IdempotencySubject {
  reservationId?: string;
  waitlistEntryId?: string;
}

interface WaitlistPlacement {
  waitlistNumber: number;
  position: number;
  eventClosed: boolean;
}

interface PublicMessageTemplates {
  REQUEST_RECEIVED: string;
  WAITLISTED: string;
}

async function hasActiveInstagramRequest(
  client: PoolClient,
  eventId: string,
  handles: string[],
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM reservations r
      WHERE r.event_id = $1
        AND r.status = 'CONFIRMED'
        AND (r.instagram_handle = ANY($2::text[]) OR EXISTS (
          SELECT 1 FROM request_guests g
           WHERE g.reservation_id = r.id AND g.instagram_handle = ANY($2::text[])
        ))
     UNION ALL
     SELECT 1
       FROM waitlist_entries w
      WHERE w.event_id = $1
        AND w.status = 'WAITING'
        AND (w.instagram_handle = ANY($2::text[]) OR EXISTS (
          SELECT 1 FROM request_guests g
           WHERE g.waitlist_entry_id = w.id AND g.instagram_handle = ANY($2::text[])
        ))
     LIMIT 1`,
    [eventId, handles],
  );
  return (result.rowCount ?? 0) > 0;
}

async function insertCompanions(
  client: PoolClient,
  command: SharedAllocationCommand,
  subject: { reservationId: string } | { waitlistEntryId: string },
): Promise<void> {
  const column = "reservationId" in subject ? "reservation_id" : "waitlist_entry_id";
  const id = "reservationId" in subject ? subject.reservationId : subject.waitlistEntryId;
  const companions = command.guests.slice(1);
  await client.query(
    `INSERT INTO request_guests (${column}, slot, full_name, instagram_handle)
     SELECT $1, guest.slot + 1, guest.name, guest.instagram
       FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS guest(name, instagram, slot)`,
    [id, companions.map((guest) => guest.name), companions.map((guest) => guest.instagram)],
  );
}

async function loadPublicMessageTemplates(client: PoolClient): Promise<PublicMessageTemplates> {
  const result = await client.query<{ key: keyof PublicMessageTemplates; body: string }>(
    `SELECT key, body
       FROM message_templates
      WHERE key IN ('REQUEST_RECEIVED', 'WAITLISTED')`,
  );
  const templates = Object.fromEntries(result.rows.map((row) => [row.key, row.body]));
  if (!templates.REQUEST_RECEIVED || !templates.WAITLISTED) {
    throw new Error("Public guest message templates not found");
  }
  return templates as unknown as PublicMessageTemplates;
}

function publicMessageValues(
  command: SharedAllocationCommand,
  eventStartsAt: Date,
): Record<string, string> {
  return {
    nombre: firstName(command.guests[0]!.name),
    nombres: guestFirstNames(command.guests.map((guest) => guest.name)),
    fecha: formatPublicEventDate(eventStartsAt),
  };
}

async function completeIdempotencyRecord(
  client: PoolClient,
  key: string,
  response: ReservationResponse,
  subject: IdempotencySubject,
): Promise<void> {
  await client.query(
    `UPDATE idempotency_records
        SET response_status = $2,
            response_body = $3::jsonb,
            reservation_id = $4,
            waitlist_entry_id = $5,
            completed_at = clock_timestamp()
      WHERE key = $1`,
    [
      key,
      response.status,
      JSON.stringify(response.body),
      subject.reservationId ?? null,
      subject.waitlistEntryId ?? null,
    ],
  );
}

async function commitResult(
  client: PoolClient,
  command: SharedAllocationCommand,
  outcome: AllocationOutcome,
  subject: IdempotencySubject = {},
): Promise<AllocationResult> {
  const response = command.mapOutcome(outcome);
  await completeIdempotencyRecord(client, command.idempotencyKey, response, subject);
  await client.query("COMMIT");
  return { ...response, replayed: false, outcome };
}

async function insertEventClosedAudit(
  client: PoolClient,
  eventId: string,
  policy: AllocationPolicy,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, action, entity_type, entity_id, metadata${policy.imported ? ", actor_admin_id" : ""}
     )
     VALUES (
       '${policy.imported ? "ADMIN" : "SYSTEM"}', 'EVENT_CLOSED', 'EVENT', $1, $2::jsonb${policy.imported ? ", $3" : ""}
     )`,
    [
      eventId,
      JSON.stringify({ reason: "CAPACITY_REACHED", ...importAuditMetadata(policy) }),
      ...(policy.imported ? [policy.imported.adminId] : []),
    ],
  );
}

async function claimWaitlistPlace(
  client: PoolClient,
  eventId: string,
  partySize: number,
  policy: AllocationPolicy,
): Promise<WaitlistPlacement | null> {
  const result = await client.query<{
    last_waitlist_number: number;
    waitlisted_count: number;
    status: EventRow["status"];
  }>(
    `UPDATE events
        SET waitlisted_count = waitlisted_count + 1,
            last_waitlist_number = last_waitlist_number + 1,
            status = CASE
              WHEN auto_close_on_full
                   AND waitlisted_count + 1 = waitlist_capacity
                   AND reserved_seats = capacity
              THEN 'CLOSED'::event_status
              ELSE status
            END,
            updated_at = clock_timestamp()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ${allocationWindow(policy)}
        AND $2 <= max_party_size
        AND reserved_seats + $2 > capacity
        AND waitlisted_count < waitlist_capacity
      RETURNING last_waitlist_number, waitlisted_count, status`,
    [eventId, partySize],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    waitlistNumber: row.last_waitlist_number,
    position: row.waitlisted_count,
    eventClosed: row.status === "CLOSED",
  };
}

async function insertWaitlistEntry(
  client: PoolClient,
  eventId: string,
  waitlistNumber: number,
  command: SharedAllocationCommand,
  policy: AllocationPolicy,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle,
       phone_e164, email, email_normalized, party_size, notes, allergies,
       terms_accepted_at, link_code, source, idempotency_key, submitted_at${policy.imported ? ", created_by" : ""}
     )
     SELECT
       $1, $2, 'WAITING', $3, $4,
       NULL, NULL, NULL, $5, $6, $7,
       ${policy.imported ? "NULL" : "transaction_timestamp()"}, $8, '${policy.imported ? "ADMIN" : "PUBLIC"}', $9, transaction_timestamp()${policy.imported ? ", $10" : ""}
     WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE link_code = $8)
     RETURNING id`,
    [
      eventId,
      waitlistNumber,
      command.guests[0]!.name,
      command.guests[0]!.instagram,
      command.guests.length,
      command.notes ?? null,
      command.allergies,
      command.linkCode,
      command.idempotencyKey,
      ...(policy.imported ? [policy.imported.adminId] : []),
    ],
  );
  const entry = result.rows[0];

  if (!entry) {
    throw new LinkCodeCollisionError();
  }

  await insertCompanions(client, command, { waitlistEntryId: entry.id });
  return entry.id;
}

async function recordWaitlisting(
  client: PoolClient,
  eventId: string,
  entryId: string,
  placement: WaitlistPlacement,
  partySize: number,
  messageBody: string,
  policy: AllocationPolicy,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, action, entity_type, entity_id, metadata${policy.imported ? ", actor_admin_id" : ""}
     )
     VALUES (
       '${policy.imported ? "ADMIN" : "PUBLIC"}', 'RESERVATION_WAITLISTED', 'WAITLIST_ENTRY', $1, $2::jsonb${policy.imported ? ", $3" : ""}
     )`,
    [
      entryId,
      JSON.stringify({
        eventId,
        waitlistNumber: placement.waitlistNumber,
        partySize,
        ...importAuditMetadata(policy),
      }),
      ...(policy.imported ? [policy.imported.adminId] : []),
    ],
  );
  await enqueueGuestMessage(client, {
    kind: "WAITLISTED",
    subject: { waitlistEntryId: entryId },
    eventId,
    body: messageBody,
    source: "SYSTEM",
  });
  if (placement.eventClosed) {
    await insertEventClosedAudit(client, eventId, policy);
  }
}

async function readCompletedRecord(
  client: Pick<Pool, "query"> | PoolClient,
  key: string,
): Promise<CompletedIdempotencyRecord | null> {
  const result = await client.query<CompletedRecordRow>(
    `SELECT request_fingerprint, response_status, response_body
       FROM idempotency_records
      WHERE key = $1
        AND completed_at IS NOT NULL`,
    [key],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    requestFingerprint: row.request_fingerprint,
    response: {
      status: row.response_status,
      body: row.response_body,
    },
  };
}

export class PostgresReservationAllocationRepository implements ReservationAllocationRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  findCompletedIdempotencyRecord(key: string): Promise<CompletedIdempotencyRecord | null> {
    return readCompletedRecord(this.pool, key);
  }

  allocate(command: AllocationCommand): Promise<AllocationResult> {
    return this.allocateWithPolicy(command, {
      eventColumn: "slug",
      eventSelector: command.eventSlug,
    });
  }

  allocateImported(command: ImportAllocationCommand): Promise<AllocationResult> {
    return this.allocateWithPolicy(command, {
      eventColumn: "id",
      eventSelector: command.eventId,
      imported: {
        adminId: command.adminId,
        importId: command.importId,
        rowNumber: command.rowNumber,
      },
    });
  }

  private async allocateWithPolicy(
    command: SharedAllocationCommand,
    policy: AllocationPolicy,
  ): Promise<AllocationResult> {
    let client: PoolClient | undefined;
    let releaseError: Error | boolean | undefined;
    const partySize = command.guests.length;
    const handles = command.guests.map((guest) => guest.instagram);

    try {
      client = await this.pool.connect();
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");

      const claim = await client.query<{ key: string }>(
        `INSERT INTO idempotency_records (key, scope, request_fingerprint)
         VALUES ($1, '${policy.imported ? "reservation_import" : "reservation_submit"}', $2)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [command.idempotencyKey, command.fingerprint],
      );

      if (claim.rowCount === 0) {
        const completed = await readCompletedRecord(client, command.idempotencyKey);
        if (!completed) {
          throw new Error("Committed idempotency record is incomplete");
        }

        await client.query("COMMIT");
        if (completed.requestFingerprint !== command.fingerprint) {
          return {
            ...command.mapOutcome({ code: "IDEMPOTENCY_KEY_REUSED" }),
            replayed: false,
          };
        }

        return { ...completed.response, replayed: true };
      }

      const eventResult = await client.query<EventRow>(
        `SELECT id, status, starts_at, opens_at, closes_at,
                capacity, reserved_seats, max_party_size${policy.imported ? ", clock_timestamp() AS database_now" : ""}
           FROM events
          WHERE ${policy.eventColumn} = $1
            AND deleted_at IS NULL`,
        [policy.eventSelector],
      );
      const event = eventResult.rows[0];

      if (!event || (!policy.imported && event.status === "DRAFT")) {
        return await commitResult(client, command, { code: "EVENT_NOT_FOUND" });
      }

      if (
        policy.imported &&
        ((event.status !== "SCHEDULED" && event.status !== "CLOSED") ||
          event.starts_at <= event.database_now!)
      ) {
        return await commitResult(client, command, { code: "EVENT_NOT_OPEN" });
      }

      if (await hasActiveInstagramRequest(client, event.id, handles)) {
        return await commitResult(client, command, { code: "DUPLICATE_RESERVATION" });
      }

      const messageTemplates = await loadPublicMessageTemplates(client);
      const messageValues = publicMessageValues(command, event.starts_at);
      const requestReceivedBody = renderMessageTemplate(
        messageTemplates.REQUEST_RECEIVED,
        messageValues,
      );

      const acquired = await client.query<AcquiredEventRow>(
        `UPDATE events
            SET reserved_seats = reserved_seats + $2,
                last_reservation_number = last_reservation_number + 1,
                status = CASE
                  WHEN auto_close_on_full
                    AND reserved_seats + $2 = capacity
                    AND waitlisted_count = waitlist_capacity
                  THEN 'CLOSED'::event_status
                  ELSE status
                END,
                updated_at = clock_timestamp()
          WHERE id = $1
            AND deleted_at IS NULL
            AND ${allocationWindow(policy)}
            AND $2 <= max_party_size
            AND reserved_seats + $2 <= capacity
          RETURNING last_reservation_number, status,
                    clock_timestamp() AS accepted_at`,
        [event.id, partySize],
      );
      const allocation = acquired.rows[0];

      if (!allocation) {
        const failureResult = await client.query<EventRow & { database_now: Date }>(
          `SELECT id, status, starts_at, opens_at, closes_at,
                  capacity, reserved_seats, max_party_size,
                  clock_timestamp() AS database_now
             FROM events
            WHERE id = $1`,
          [event.id],
        );
        const failedEvent = failureResult.rows[0];
        if (!failedEvent) {
          throw new Error("Event disappeared during reservation allocation");
        }

        const classifyFailure = policy.imported
          ? classifyImportAllocationFailure
          : classifyAllocationFailure;
        const failure = classifyFailure(
          {
            status: failedEvent.status,
            startsAt: failedEvent.starts_at,
            opensAt: failedEvent.opens_at,
            closesAt: failedEvent.closes_at,
            capacity: failedEvent.capacity,
            reservedSeats: failedEvent.reserved_seats,
            maxPartySize: failedEvent.max_party_size,
          },
          partySize,
          failedEvent.database_now,
        );

        if (failure === "TRY_AGAIN") {
          await rollback(client);
          return {
            ...command.mapOutcome({ code: "TRY_AGAIN" }),
            replayed: false,
          };
        }

        if (failure !== "EVENT_FULL") {
          return await commitResult(client, command, { code: failure });
        }

        const placement = await claimWaitlistPlace(client, event.id, partySize, policy);

        if (placement) {
          if (await hasActiveInstagramRequest(client, event.id, handles)) {
            throw new DuplicateUnderEventLockError();
          }

          const entryId = await insertWaitlistEntry(
            client,
            event.id,
            placement.waitlistNumber,
            command,
            policy,
          );
          const waitlistedBody = renderMessageTemplate(messageTemplates.WAITLISTED, {
            ...messageValues,
            posicion: String(placement.position),
          });
          await recordWaitlisting(
            client,
            event.id,
            entryId,
            placement,
            partySize,
            waitlistedBody,
            policy,
          );

          return await commitResult(
            client,
            command,
            {
              code: "WAITLISTED",
              position: placement.position,
              partySize,
              eventStartsAt: event.starts_at,
              linkCode: command.linkCode,
            },
            { waitlistEntryId: entryId },
          );
        }

        const rejected = await client.query<{ id: string }>(
          `INSERT INTO reservations (
             event_id, status, full_name, instagram_handle,
             phone_e164, email, email_normalized, party_size, notes, allergies,
             terms_accepted_at, source, idempotency_key, submitted_at${policy.imported ? ", created_by" : ""}
           )
           VALUES (
             $1, 'FULL_REJECTED', $2, $3,
             NULL, NULL, NULL, $4, $5, $6,
             ${policy.imported ? "NULL" : "transaction_timestamp()"}, '${policy.imported ? "ADMIN" : "PUBLIC"}', $7, transaction_timestamp()${policy.imported ? ", $8" : ""}
           )
           RETURNING id`,
          [
            event.id,
            command.guests[0]!.name,
            command.guests[0]!.instagram,
            partySize,
            command.notes ?? null,
            // Rejected guests get no seat, so their health data is not kept.
            null,
            command.idempotencyKey,
            ...(policy.imported ? [policy.imported.adminId] : []),
          ],
        );

        await insertCompanions(client, command, { reservationId: rejected.rows[0]!.id });
        return await commitResult(
          client,
          command,
          { code: "EVENT_FULL" },
          { reservationId: rejected.rows[0]!.id },
        );
      }

      if (await hasActiveInstagramRequest(client, event.id, handles)) {
        throw new DuplicateUnderEventLockError();
      }

      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle,
           phone_e164, email, email_normalized, party_size, notes, allergies,
           terms_accepted_at, link_code, source, idempotency_key, submitted_at, accepted_at${policy.imported ? ", created_by" : ""}
         )
         SELECT
           $1, $2, 'CONFIRMED', $3, $4,
           NULL, NULL, NULL, $5, $6, $7,
           ${policy.imported ? "NULL" : "transaction_timestamp()"}, $8, '${policy.imported ? "ADMIN" : "PUBLIC"}', $9, transaction_timestamp(), $10${policy.imported ? ", $11" : ""}
         WHERE NOT EXISTS (SELECT 1 FROM waitlist_entries WHERE link_code = $8)
         RETURNING id`,
        [
          event.id,
          allocation.last_reservation_number,
          command.guests[0]!.name,
          command.guests[0]!.instagram,
          partySize,
          command.notes ?? null,
          command.allergies,
          command.linkCode,
          command.idempotencyKey,
          allocation.accepted_at,
          ...(policy.imported ? [policy.imported.adminId] : []),
        ],
      );
      const insertedReservation = reservation.rows[0];

      if (!insertedReservation) {
        throw new LinkCodeCollisionError();
      }

      const reservationId = insertedReservation.id;
      await insertCompanions(client, command, { reservationId });

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, action, entity_type, entity_id, metadata${policy.imported ? ", actor_admin_id" : ""}
         )
         VALUES (
           '${policy.imported ? "ADMIN" : "PUBLIC"}', 'RESERVATION_CREATED', 'RESERVATION', $1, $2::jsonb${policy.imported ? ", $3" : ""}
         )`,
        [
          reservationId,
          JSON.stringify({
            eventId: event.id,
            reservationNumber: allocation.last_reservation_number,
            partySize,
            ...importAuditMetadata(policy),
          }),
          ...(policy.imported ? [policy.imported.adminId] : []),
        ],
      );

      await enqueueGuestMessage(client, {
        kind: "REQUEST_RECEIVED",
        subject: { reservationId },
        eventId: event.id,
        body: requestReceivedBody,
        source: "SYSTEM",
      });

      if (allocation.status === "CLOSED") {
        await insertEventClosedAudit(client, event.id, policy);
      }

      return await commitResult(
        client,
        command,
        {
          code: "RECEIVED",
          number: allocation.last_reservation_number,
          partySize,
          eventStartsAt: event.starts_at,
          linkCode: command.linkCode,
        },
        { reservationId },
      );
    } catch (error) {
      if (client) {
        try {
          await rollback(client);
        } catch {
          releaseError = error instanceof Error ? error : true;
          throw error;
        }
      }
      const details = databaseError(error);

      if (error instanceof DuplicateUnderEventLockError) {
        return {
          ...command.mapOutcome({ code: "DUPLICATE_RESERVATION" }),
          replayed: false,
        };
      }

      const isLinkCodeCollision =
        error instanceof LinkCodeCollisionError ||
        (details.code === "23505" && linkCodeConstraints.has(details.constraint ?? ""));

      if (isLinkCodeCollision) {
        return {
          ...command.mapOutcome({ code: "TRY_AGAIN" }),
          replayed: false,
        };
      }

      if (retryableDatabaseErrorCode(error)) {
        return {
          ...command.mapOutcome({ code: "TRY_AGAIN" }),
          replayed: false,
        };
      }

      throw error;
    } finally {
      client?.release(releaseError);
    }
  }

  async cancelReservation(command: CancelReservationCommand): Promise<CancelReservationOutcome> {
    const client = await this.pool.connect();
    let releaseError: Error | boolean | undefined;

    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      const eventResult = await client.query<{ event_id: string }>(
        `SELECT e.id AS event_id
           FROM reservations r
          JOIN events e ON e.id = r.event_id
          WHERE r.id = $1
            AND e.deleted_at IS NULL
          FOR UPDATE OF e`,
        [command.reservationId],
      );
      const eventId = eventResult.rows[0]?.event_id;

      if (!eventId) {
        await client.query("COMMIT");
        return "NOT_FOUND";
      }

      const cancelled = await client.query<{ party_size: number }>(
        `UPDATE reservations
            SET status = 'CANCELLED',
                cancelled_at = clock_timestamp(),
                release_reason = 'CANCELLED',
                refund_status = CASE WHEN stage = 'PAID' THEN 'PENDING' ELSE NULL END,
                updated_at = clock_timestamp()
          WHERE id = $1
            AND status = 'CONFIRMED'
          RETURNING party_size`,
        [command.reservationId],
      );
      const partySize = cancelled.rows[0]?.party_size;

      if (partySize === undefined) {
        await client.query("COMMIT");
        return "NOT_CANCELLABLE";
      }

      await client.query(
        `UPDATE events
            SET reserved_seats = reserved_seats - $2,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [eventId, partySize],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         )
         VALUES (
           'ADMIN', $2, 'RESERVATION_CANCELLED', 'RESERVATION', $1, $3::jsonb
         )`,
        [command.reservationId, command.actorAdminId, JSON.stringify({ eventId, partySize })],
      );
      await promoteWaitlist(client, eventId);
      await client.query("COMMIT");
      return "CANCELLED";
    } catch (error) {
      try {
        await rollback(client);
      } catch {
        releaseError = error instanceof Error ? error : true;
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  async cancelWaitlistEntry(
    command: CancelWaitlistEntryCommand,
  ): Promise<CancelWaitlistEntryOutcome> {
    const client = await this.pool.connect();
    let releaseError: Error | boolean | undefined;

    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
      const eventResult = await client.query<{ event_id: string }>(
        `SELECT e.id AS event_id
           FROM waitlist_entries w
          JOIN events e ON e.id = w.event_id
          WHERE w.id = $1
            AND e.deleted_at IS NULL
          FOR UPDATE OF e`,
        [command.waitlistEntryId],
      );
      const eventId = eventResult.rows[0]?.event_id;

      if (!eventId) {
        await client.query("COMMIT");
        return "NOT_FOUND";
      }

      const cancelled = await client.query(
        `UPDATE waitlist_entries
            SET status = 'CANCELLED',
                cancelled_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1
            AND status = 'WAITING'`,
        [command.waitlistEntryId],
      );

      if (cancelled.rowCount === 0) {
        await client.query("COMMIT");
        return "NOT_CANCELLABLE";
      }

      await client.query(
        `UPDATE events
            SET waitlisted_count = waitlisted_count - 1,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [eventId],
      );
      await client.query(
        `INSERT INTO audit_logs (
           actor_type, actor_admin_id, action, entity_type, entity_id, metadata
         )
         VALUES (
           'ADMIN', $2, 'WAITLIST_CANCELLED', 'WAITLIST_ENTRY', $1, $3::jsonb
         )`,
        [command.waitlistEntryId, command.actorAdminId, JSON.stringify({ eventId })],
      );
      await promoteWaitlist(client, eventId);
      await client.query("COMMIT");
      return "CANCELLED";
    } catch (error) {
      try {
        await rollback(client);
      } catch {
        releaseError = error instanceof Error ? error : true;
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }
}
