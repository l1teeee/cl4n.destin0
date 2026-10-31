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
  ReservationAllocationRepository,
  ReservationResponse,
} from "@/application/ports/reservation-allocation-repository";
import { renderMessageTemplate } from "@/domain/messaging/message-template";
import { classifyAllocationFailure } from "@/domain/reservation/allocation-failure";
import { firstName, guestFirstNames } from "@/domain/reservation/guest-names";
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
  command: AllocationCommand,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM reservations
      WHERE event_id = $1
        AND status = 'CONFIRMED'
        AND (instagram_handle IN ($2, $3) OR guest2_instagram_handle IN ($2, $3))
     UNION ALL
     SELECT 1
       FROM waitlist_entries
      WHERE event_id = $1
        AND status = 'WAITING'
        AND (instagram_handle IN ($2, $3) OR guest2_instagram_handle IN ($2, $3))
     LIMIT 1`,
    [eventId, command.instagramHandle, command.guest2InstagramHandle],
  );
  return (result.rowCount ?? 0) > 0;
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
  command: AllocationCommand,
  eventStartsAt: Date,
): Record<string, string> {
  return {
    nombre: firstName(command.fullName),
    nombres: guestFirstNames(command.fullName, command.guest2FullName),
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
  command: AllocationCommand,
  outcome: AllocationOutcome,
  subject: IdempotencySubject = {},
): Promise<AllocationResult> {
  const response = command.mapOutcome(outcome);
  await completeIdempotencyRecord(client, command.idempotencyKey, response, subject);
  await client.query("COMMIT");
  return { ...response, replayed: false, outcome };
}

async function insertEventClosedAudit(client: PoolClient, eventId: string): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, action, entity_type, entity_id, metadata
     )
     VALUES (
       'SYSTEM', 'EVENT_CLOSED', 'EVENT', $1, $2::jsonb
     )`,
    [eventId, JSON.stringify({ reason: "CAPACITY_REACHED" })],
  );
}

async function claimWaitlistPlace(
  client: PoolClient,
  eventId: string,
  partySize: number,
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
        AND status = 'SCHEDULED'
        AND opens_at <= clock_timestamp()
        AND closes_at > clock_timestamp()
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
  command: AllocationCommand,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO waitlist_entries (
       event_id, waitlist_number, status, full_name, instagram_handle,
       guest2_full_name, guest2_instagram_handle,
       phone_e164, email, email_normalized, party_size, notes, allergies,
       terms_accepted_at, link_code, source, idempotency_key, submitted_at
     )
     SELECT
       $1, $2, 'WAITING', $3, $4,
       $5, $6,
       NULL, NULL, NULL, $7, $8, $9,
       transaction_timestamp(), $10, 'PUBLIC', $11, transaction_timestamp()
     WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE link_code = $10)
     RETURNING id`,
    [
      eventId,
      waitlistNumber,
      command.fullName,
      command.instagramHandle,
      command.guest2FullName,
      command.guest2InstagramHandle,
      command.partySize,
      command.notes ?? null,
      command.allergies,
      command.linkCode,
      command.idempotencyKey,
    ],
  );
  const entry = result.rows[0];

  if (!entry) {
    throw new LinkCodeCollisionError();
  }

  return entry.id;
}

async function recordWaitlisting(
  client: PoolClient,
  eventId: string,
  entryId: string,
  placement: WaitlistPlacement,
  partySize: number,
  messageBody: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, action, entity_type, entity_id, metadata
     )
     VALUES (
       'PUBLIC', 'RESERVATION_WAITLISTED', 'WAITLIST_ENTRY', $1, $2::jsonb
     )`,
    [entryId, JSON.stringify({ eventId, waitlistNumber: placement.waitlistNumber, partySize })],
  );
  await enqueueGuestMessage(client, {
    kind: "WAITLISTED",
    subject: { waitlistEntryId: entryId },
    eventId,
    body: messageBody,
    source: "SYSTEM",
  });
  if (placement.eventClosed) {
    await insertEventClosedAudit(client, eventId);
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

  async allocate(command: AllocationCommand): Promise<AllocationResult> {
    let client: PoolClient | undefined;
    let releaseError: Error | boolean | undefined;

    try {
      client = await this.pool.connect();
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");

      const claim = await client.query<{ key: string }>(
        `INSERT INTO idempotency_records (key, scope, request_fingerprint)
         VALUES ($1, 'reservation_submit', $2)
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
                capacity, reserved_seats, max_party_size
           FROM events
          WHERE slug = $1
            AND deleted_at IS NULL`,
        [command.eventSlug],
      );
      const event = eventResult.rows[0];

      if (!event || event.status === "DRAFT") {
        return await commitResult(client, command, { code: "EVENT_NOT_FOUND" });
      }

      if (await hasActiveInstagramRequest(client, event.id, command)) {
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
            AND status = 'SCHEDULED'
            AND opens_at <= clock_timestamp()
            AND closes_at > clock_timestamp()
            AND $2 <= max_party_size
            AND reserved_seats + $2 <= capacity
          RETURNING last_reservation_number, status,
                    clock_timestamp() AS accepted_at`,
        [event.id, command.partySize],
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

        const failure = classifyAllocationFailure(
          {
            status: failedEvent.status,
            opensAt: failedEvent.opens_at,
            closesAt: failedEvent.closes_at,
            capacity: failedEvent.capacity,
            reservedSeats: failedEvent.reserved_seats,
            maxPartySize: failedEvent.max_party_size,
          },
          command.partySize,
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

        const placement = await claimWaitlistPlace(client, event.id, command.partySize);

        if (placement) {
          if (await hasActiveInstagramRequest(client, event.id, command)) {
            throw new DuplicateUnderEventLockError();
          }

          const entryId = await insertWaitlistEntry(
            client,
            event.id,
            placement.waitlistNumber,
            command,
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
            command.partySize,
            waitlistedBody,
          );

          return await commitResult(
            client,
            command,
            {
              code: "WAITLISTED",
              position: placement.position,
              partySize: command.partySize,
              eventStartsAt: event.starts_at,
              linkCode: command.linkCode,
            },
            { waitlistEntryId: entryId },
          );
        }

        const rejected = await client.query<{ id: string }>(
          `INSERT INTO reservations (
             event_id, status, full_name, instagram_handle,
             guest2_full_name, guest2_instagram_handle,
             phone_e164, email, email_normalized, party_size, notes, allergies,
             terms_accepted_at, source, idempotency_key, submitted_at
           )
           VALUES (
             $1, 'FULL_REJECTED', $2, $3, $4,
             $5, NULL, NULL, NULL, $6, $7, $8,
             transaction_timestamp(), 'PUBLIC', $9, transaction_timestamp()
           )
           RETURNING id`,
          [
            event.id,
            command.fullName,
            command.instagramHandle,
            command.guest2FullName,
            command.guest2InstagramHandle,
            command.partySize,
            command.notes ?? null,
            // Rejected guests get no seat, so their health data is not kept.
            null,
            command.idempotencyKey,
          ],
        );

        return await commitResult(
          client,
          command,
          { code: "EVENT_FULL" },
          { reservationId: rejected.rows[0]!.id },
        );
      }

      if (await hasActiveInstagramRequest(client, event.id, command)) {
        throw new DuplicateUnderEventLockError();
      }

      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle,
           guest2_full_name, guest2_instagram_handle,
           phone_e164, email, email_normalized, party_size, notes, allergies,
           terms_accepted_at, link_code, source, idempotency_key, submitted_at, accepted_at
         )
         SELECT
           $1, $2, 'CONFIRMED', $3, $4,
           $5, $6,
           NULL, NULL, NULL, $7, $8, $9,
           transaction_timestamp(), $10, 'PUBLIC', $11, transaction_timestamp(), $12
         WHERE NOT EXISTS (SELECT 1 FROM waitlist_entries WHERE link_code = $10)
         RETURNING id`,
        [
          event.id,
          allocation.last_reservation_number,
          command.fullName,
          command.instagramHandle,
          command.guest2FullName,
          command.guest2InstagramHandle,
          command.partySize,
          command.notes ?? null,
          command.allergies,
          command.linkCode,
          command.idempotencyKey,
          allocation.accepted_at,
        ],
      );
      const insertedReservation = reservation.rows[0];

      if (!insertedReservation) {
        throw new LinkCodeCollisionError();
      }

      const reservationId = insertedReservation.id;

      await client.query(
        `INSERT INTO audit_logs (
           actor_type, action, entity_type, entity_id, metadata
         )
         VALUES (
           'PUBLIC', 'RESERVATION_CREATED', 'RESERVATION', $1, $2::jsonb
         )`,
        [
          reservationId,
          JSON.stringify({
            eventId: event.id,
            reservationNumber: allocation.last_reservation_number,
            partySize: command.partySize,
          }),
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
        await insertEventClosedAudit(client, event.id);
      }

      return await commitResult(
        client,
        command,
        {
          code: "RECEIVED",
          number: allocation.last_reservation_number,
          partySize: command.partySize,
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
