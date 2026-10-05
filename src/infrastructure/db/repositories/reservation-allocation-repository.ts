import type { Pool, PoolClient } from "pg";

import type {
  AllocationCommand,
  AllocationOutcome,
  AllocationResult,
  CancelReservationCommand,
  CancelReservationOutcome,
  CompletedIdempotencyRecord,
  ReservationAllocationRepository,
  ReservationResponse,
} from "@/application/ports/reservation-allocation-repository";
import { classifyAllocationFailure } from "@/domain/reservation/allocation-failure";

import { pool as applicationPool } from "../client";
import { retryableDatabaseErrorCode } from "../retryable-database-error";

interface DatabaseError {
  code?: string;
  constraint?: string;
}

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

const duplicateConstraints = new Set([
  "reservations_one_confirmed_per_email_uq",
  "reservations_one_confirmed_per_phone_uq",
]);

function databaseError(error: unknown): DatabaseError {
  return typeof error === "object" && error !== null ? (error as DatabaseError) : {};
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK");
}

async function completeIdempotencyRecord(
  client: PoolClient,
  key: string,
  response: ReservationResponse,
  reservationId: string | null,
): Promise<void> {
  await client.query(
    `UPDATE idempotency_records
        SET response_status = $2,
            response_body = $3::jsonb,
            reservation_id = $4,
            completed_at = clock_timestamp()
      WHERE key = $1`,
    [key, response.status, JSON.stringify(response.body), reservationId],
  );
}

async function commitResult(
  client: PoolClient,
  command: AllocationCommand,
  outcome: AllocationOutcome,
  reservationId: string | null = null,
): Promise<AllocationResult> {
  const response = command.mapOutcome(outcome);
  await completeIdempotencyRecord(client, command.idempotencyKey, response, reservationId);
  await client.query("COMMIT");
  return { ...response, replayed: false };
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
          WHERE slug = $1`,
        [command.eventSlug],
      );
      const event = eventResult.rows[0];

      if (!event || event.status === "DRAFT") {
        return await commitResult(client, command, { code: "EVENT_NOT_FOUND" });
      }

      const duplicate = await client.query(
        `SELECT 1
           FROM reservations
          WHERE event_id = $1
            AND status = 'CONFIRMED'
            AND (email_normalized = $2 OR phone_e164 = $3)
          LIMIT 1`,
        [event.id, command.emailNormalized, command.phoneE164],
      );

      if ((duplicate.rowCount ?? 0) > 0) {
        return await commitResult(client, command, { code: "DUPLICATE_RESERVATION" });
      }

      const acquired = await client.query<AcquiredEventRow>(
        `UPDATE events
            SET reserved_seats = reserved_seats + $2,
                last_reservation_number = last_reservation_number + 1,
                status = CASE
                  WHEN auto_close_on_full AND reserved_seats + $2 = capacity
                  THEN 'CLOSED'::event_status
                  ELSE status
                END,
                updated_at = clock_timestamp()
          WHERE id = $1
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

        const rejected = await client.query<{ id: string }>(
          `INSERT INTO reservations (
             event_id, status, full_name, instagram_handle, phone_e164,
             email, email_normalized, party_size, notes, terms_accepted_at,
             idempotency_key, submitted_at
           )
           VALUES (
             $1, 'FULL_REJECTED', $2, $3, $4,
             $5, $6, $7, $8, transaction_timestamp(),
             $9, transaction_timestamp()
           )
           RETURNING id`,
          [
            event.id,
            command.fullName,
            command.instagramHandle,
            command.phoneE164,
            command.email,
            command.emailNormalized,
            command.partySize,
            command.notes ?? null,
            command.idempotencyKey,
          ],
        );

        return await commitResult(client, command, { code: "EVENT_FULL" }, rejected.rows[0]!.id);
      }

      const reservation = await client.query<{ id: string }>(
        `INSERT INTO reservations (
           event_id, reservation_number, status, full_name, instagram_handle,
           phone_e164, email, email_normalized, party_size, notes,
           terms_accepted_at, idempotency_key, submitted_at, accepted_at
         )
         VALUES (
           $1, $2, 'CONFIRMED', $3, $4,
           $5, $6, $7, $8, $9,
           transaction_timestamp(), $10, transaction_timestamp(), $11
         )
         RETURNING id`,
        [
          event.id,
          allocation.last_reservation_number,
          command.fullName,
          command.instagramHandle,
          command.phoneE164,
          command.email,
          command.emailNormalized,
          command.partySize,
          command.notes ?? null,
          command.idempotencyKey,
          allocation.accepted_at,
        ],
      );
      const reservationId = reservation.rows[0]!.id;

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

      if (allocation.status === "CLOSED") {
        await client.query(
          `INSERT INTO audit_logs (
             actor_type, action, entity_type, entity_id, metadata
           )
           VALUES (
             'SYSTEM', 'EVENT_CLOSED', 'EVENT', $1, $2::jsonb
           )`,
          [event.id, JSON.stringify({ reason: "CAPACITY_REACHED" })],
        );
      }

      return await commitResult(
        client,
        command,
        {
          code: "CONFIRMED",
          number: allocation.last_reservation_number,
          partySize: command.partySize,
          eventStartsAt: event.starts_at,
        },
        reservationId,
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

      if (details.code === "23505" && duplicateConstraints.has(details.constraint ?? "")) {
        return {
          ...command.mapOutcome({ code: "DUPLICATE_RESERVATION" }),
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
