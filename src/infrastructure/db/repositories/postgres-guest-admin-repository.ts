import type { Pool, PoolClient } from "pg";

import type {
  AddRequestCommand,
  GuestAdminRepository,
  GuestFields,
  GuestMutationFailure,
  GuestMutationResult,
  MarkRefundedCommand,
  MoveWaitlistEntryCommand,
  PromotedGuest,
  ReleaseReservationCommand,
  RemoveWaitlistEntryCommand,
  ReservationCommand,
  UpdateReservationCommand,
  UpdateWaitlistEntryCommand,
  VerifyPaymentCommand,
  WaitlistEntryCommand,
} from "@/application/guests/guest-admin-repository";
import type { TemplateKey } from "@/domain/messaging/message-types";

import { pool as applicationPool } from "../client";
import { enqueueGuestMessage, loadGuestMessageValues, renderGuestMessage } from "./guest-messages";
import {
  promoteSpecificWaitlistEntry,
  promoteWaitlistDetailed,
  type WaitlistPromotion,
} from "./waitlist-promotion";

interface EventRow {
  id: string;
  status: "DRAFT" | "SCHEDULED" | "CLOSED" | "COMPLETED" | "CANCELLED";
  starts_at: Date;
  capacity: number;
  reserved_seats: number;
  waitlist_capacity: number;
  waitlisted_count: number;
}

interface ReservationRow {
  id: string;
  event_id: string;
  status: "SUBMITTED" | "CONFIRMED" | "FULL_REJECTED" | "CANCELLED" | "EXPIRED";
  stage: "IN_REVIEW" | "ON_LIST" | "PAID";
  full_name: string;
  instagram_handle: string;
  guest2_full_name: string | null;
  guest2_instagram_handle: string | null;
  party_size: number;
  allergies: string | null;
  notes: string | null;
  refund_status: "PENDING" | "REFUNDED" | null;
  on_list_at: Date | null;
  transaction_started_at: Date;
}

interface WaitlistRow {
  id: string;
  event_id: string;
  status: "WAITING" | "PROMOTED" | "CANCELLED";
  waitlist_number: number;
  full_name: string;
  instagram_handle: string;
  guest2_full_name: string | null;
  guest2_instagram_handle: string | null;
  party_size: number;
  allergies: string | null;
  notes: string | null;
}

class RollbackResult extends Error {
  constructor(readonly result: GuestMutationFailure) {
    super(result.code);
  }
}

function failed(code: GuestMutationFailure["code"]): GuestMutationFailure {
  return { ok: false, code };
}

function guestsOf(row: Pick<ReservationRow | WaitlistRow, "full_name" | "guest2_full_name">) {
  return [row.full_name, row.guest2_full_name].filter((name): name is string => name !== null);
}

function promotedGuests(promotions: readonly WaitlistPromotion[]): PromotedGuest[] {
  return promotions.map(({ entryId, reservationId, guests }) => ({
    entryId,
    reservationId,
    guests,
  }));
}

function sameIds(actual: readonly WaitlistPromotion[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((promotion, index) => promotion.entryId === expected[index])
  );
}

async function runTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T | GuestMutationFailure> {
  const client = await pool.connect();
  let releaseError: Error | boolean | undefined;

  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : true;
    }
    if (error instanceof RollbackResult) return error.result;
    throw error;
  } finally {
    client.release(releaseError);
  }
}

async function lockEventForReservation(
  client: PoolClient,
  reservationId: string,
): Promise<EventRow | null> {
  const result = await client.query<EventRow>(
    `SELECT e.id, e.status, e.starts_at, e.capacity, e.reserved_seats,
            e.waitlist_capacity, e.waitlisted_count
       FROM reservations r
       JOIN events e ON e.id = r.event_id
      WHERE r.id = $1
        AND e.deleted_at IS NULL
      FOR UPDATE OF e`,
    [reservationId],
  );
  return result.rows[0] ?? null;
}

async function lockEventForWaitlist(client: PoolClient, entryId: string): Promise<EventRow | null> {
  const result = await client.query<EventRow>(
    `SELECT e.id, e.status, e.starts_at, e.capacity, e.reserved_seats,
            e.waitlist_capacity, e.waitlisted_count
       FROM waitlist_entries w
       JOIN events e ON e.id = w.event_id
      WHERE w.id = $1
        AND e.deleted_at IS NULL
      FOR UPDATE OF e`,
    [entryId],
  );
  return result.rows[0] ?? null;
}

async function lockEvent(client: PoolClient, eventId: string): Promise<EventRow | null> {
  const result = await client.query<EventRow>(
    `SELECT id, status, starts_at, capacity, reserved_seats,
            waitlist_capacity, waitlisted_count
       FROM events
      WHERE id = $1
        AND deleted_at IS NULL
      FOR UPDATE`,
    [eventId],
  );
  return result.rows[0] ?? null;
}

async function lockReservation(
  client: PoolClient,
  reservationId: string,
): Promise<ReservationRow | null> {
  const result = await client.query<ReservationRow>(
    `SELECT id, event_id, status, stage, full_name, instagram_handle,
            guest2_full_name, guest2_instagram_handle, party_size,
            allergies, notes, refund_status, on_list_at,
            transaction_timestamp() AS transaction_started_at
       FROM reservations
      WHERE id = $1
      FOR UPDATE`,
    [reservationId],
  );
  return result.rows[0] ?? null;
}

async function lockWaitlistEntry(client: PoolClient, entryId: string): Promise<WaitlistRow | null> {
  const result = await client.query<WaitlistRow>(
    `SELECT id, event_id, status, waitlist_number, full_name, instagram_handle,
            guest2_full_name, guest2_instagram_handle, party_size, allergies, notes
       FROM waitlist_entries
      WHERE id = $1
      FOR UPDATE`,
    [entryId],
  );
  return result.rows[0] ?? null;
}

async function insertAudit(
  client: PoolClient,
  input: {
    actorAdminId: string;
    action: string;
    entityType: "RESERVATION" | "WAITLIST_ENTRY";
    entityId: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       actor_type, actor_admin_id, action, entity_type, entity_id, metadata
     )
     VALUES ('ADMIN', $1, $2, $3, $4, $5::jsonb)`,
    [
      input.actorAdminId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.metadata),
    ],
  );
}

async function enqueueStatusMessage(
  client: PoolClient,
  input: {
    kind: TemplateKey;
    eventId: string;
    subject: { reservationId: string } | { waitlistEntryId: string };
    actorAdminId: string;
  },
): Promise<string> {
  const values = await loadGuestMessageValues(client, input.subject);
  const body = await renderGuestMessage(client, input.kind, values);
  const message = await enqueueGuestMessage(client, {
    kind: input.kind,
    subject: input.subject,
    eventId: input.eventId,
    body,
    source: "ADMIN",
    createdBy: input.actorAdminId,
  });
  return message.id;
}

async function duplicateHandle(
  client: PoolClient,
  eventId: string,
  fields: GuestFields,
  exclude: { reservationId?: string; entryId?: string } = {},
): Promise<GuestMutationFailure | null> {
  const result = await client.query<{ handle: string }>(
    `SELECT handle
       FROM (
         SELECT instagram_handle AS handle
           FROM reservations
          WHERE event_id = $1
            AND status = 'CONFIRMED'
            AND id <> COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         UNION ALL
         SELECT guest2_instagram_handle
           FROM reservations
          WHERE event_id = $1
            AND status = 'CONFIRMED'
            AND guest2_instagram_handle IS NOT NULL
            AND id <> COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         UNION ALL
         SELECT instagram_handle
           FROM waitlist_entries
          WHERE event_id = $1
            AND status = 'WAITING'
            AND id <> COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         UNION ALL
         SELECT guest2_instagram_handle
           FROM waitlist_entries
          WHERE event_id = $1
            AND status = 'WAITING'
            AND guest2_instagram_handle IS NOT NULL
            AND id <> COALESCE($5::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       ) active_handles
      WHERE handle IN ($2, $3)
      LIMIT 1`,
    [
      eventId,
      fields.guest1Instagram,
      fields.guest2Instagram,
      exclude.reservationId ?? null,
      exclude.entryId ?? null,
    ],
  );
  const matched = result.rows[0]?.handle;
  if (!matched) return null;
  return {
    ok: false,
    code: "DUPLICATE_HANDLE",
    field: matched === fields.guest2Instagram ? "guest2Instagram" : "guest1Instagram",
  };
}

function changedFields(row: ReservationRow | WaitlistRow, fields: GuestFields): string[] {
  const changed: string[] = [];
  if (row.party_size !== fields.partySize) changed.push("partySize");
  if (row.full_name !== fields.guest1Name) changed.push("guest1Name");
  if (row.instagram_handle !== fields.guest1Instagram) changed.push("guest1Instagram");
  if (row.guest2_full_name !== fields.guest2Name) changed.push("guest2Name");
  if (row.guest2_instagram_handle !== fields.guest2Instagram) changed.push("guest2Instagram");
  if ((row.allergies !== null) !== fields.hasAllergies) changed.push("hasAllergies");
  if (row.allergies !== fields.allergies) changed.push("allergies");
  if (row.notes !== fields.notes) changed.push("notes");
  return changed;
}

async function updateGuestData(
  client: PoolClient,
  table: "reservations" | "waitlist_entries",
  id: string,
  fields: GuestFields,
): Promise<void> {
  await client.query(
    `UPDATE ${table}
        SET party_size = $2,
            full_name = $3,
            instagram_handle = $4,
            guest2_full_name = $5,
            guest2_instagram_handle = $6,
            allergies = $7,
            notes = $8,
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [
      id,
      fields.partySize,
      fields.guest1Name,
      fields.guest1Instagram,
      fields.guest2Name,
      fields.guest2Instagram,
      fields.allergies,
      fields.notes,
    ],
  );
}

export class PostgresGuestAdminRepository implements GuestAdminRepository {
  constructor(private readonly pool: Pool = applicationPool) {}

  async accept(command: ReservationCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (!reservation || reservation.status !== "CONFIRMED" || reservation.stage !== "IN_REVIEW") {
        return failed("INVALID_STAGE");
      }
      await client.query(
        `UPDATE reservations
            SET stage = 'ON_LIST', on_list_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = $1`,
        [reservation.id],
      );
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_ON_LIST",
        entityType: "RESERVATION",
        entityId: reservation.id,
        metadata: { eventId: event.id, stage: "ON_LIST", partySize: reservation.party_size },
      });
      const messageId = await enqueueStatusMessage(client, {
        kind: "ON_LIST",
        eventId: event.id,
        subject: { reservationId: reservation.id },
        actorAdminId: command.actorAdminId,
      });
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(reservation),
        messageIds: [messageId],
        promoted: [],
      };
    }) as Promise<GuestMutationResult>;
  }

  async verifyPayment(command: VerifyPaymentCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (!reservation || reservation.status !== "CONFIRMED" || reservation.stage !== "ON_LIST") {
        return failed("INVALID_STAGE");
      }
      await client.query(
        `UPDATE reservations
            SET stage = 'PAID', paid_at = clock_timestamp(), payment_note = $2,
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [reservation.id, command.paymentNote],
      );
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_PAID",
        entityType: "RESERVATION",
        entityId: reservation.id,
        metadata: { eventId: event.id, stage: "PAID", partySize: reservation.party_size },
      });
      const messageId = await enqueueStatusMessage(client, {
        kind: "PAID",
        eventId: event.id,
        subject: { reservationId: reservation.id },
        actorAdminId: command.actorAdminId,
      });
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(reservation),
        messageIds: [messageId],
        promoted: [],
      };
    }) as Promise<GuestMutationResult>;
  }

  async reject(command: ReleaseReservationCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (!reservation || reservation.status !== "CONFIRMED" || reservation.stage !== "IN_REVIEW") {
        return failed("INVALID_STAGE");
      }
      await client.query(
        `UPDATE reservations
            SET status = 'CANCELLED', release_reason = 'REJECTED',
                cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = $1`,
        [reservation.id],
      );
      await client.query(
        `UPDATE events
            SET reserved_seats = reserved_seats - $2, updated_at = clock_timestamp()
          WHERE id = $1`,
        [event.id, reservation.party_size],
      );
      const messageIds: string[] = [];
      if (command.sendMessage) {
        messageIds.push(
          await enqueueStatusMessage(client, {
            kind: "REJECTED",
            eventId: event.id,
            subject: { reservationId: reservation.id },
            actorAdminId: command.actorAdminId,
          }),
        );
      }
      const promotions = await promoteWaitlistDetailed(client, event.id);
      if (!sameIds(promotions, command.expectedPromotedEntryIds)) {
        throw new RollbackResult(failed("WAITLIST_CHANGED"));
      }
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_REJECTED",
        entityType: "RESERVATION",
        entityId: reservation.id,
        metadata: {
          eventId: event.id,
          stage: reservation.stage,
          partySize: reservation.party_size,
          promotedCount: promotions.length,
        },
      });
      messageIds.push(...promotions.map((promotion) => promotion.messageId));
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(reservation),
        messageIds,
        promoted: promotedGuests(promotions),
      };
    }) as Promise<GuestMutationResult>;
  }

  async cancel(
    command: ReleaseReservationCommand,
  ): Promise<GuestMutationResult<{ refundPending: boolean }>> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (
        !reservation ||
        reservation.status !== "CONFIRMED" ||
        !["ON_LIST", "PAID"].includes(reservation.stage) ||
        (reservation.stage === "ON_LIST" &&
          reservation.on_list_at !== null &&
          reservation.on_list_at >= reservation.transaction_started_at)
      ) {
        return failed("INVALID_STAGE");
      }
      const refundPending = reservation.stage === "PAID";
      await client.query(
        `UPDATE reservations
            SET status = 'CANCELLED', release_reason = 'CANCELLED',
                refund_status = CASE WHEN stage = 'PAID' THEN 'PENDING' ELSE NULL END,
                cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = $1`,
        [reservation.id],
      );
      await client.query(
        `UPDATE events
            SET reserved_seats = reserved_seats - $2, updated_at = clock_timestamp()
          WHERE id = $1`,
        [event.id, reservation.party_size],
      );
      const messageIds: string[] = [];
      if (command.sendMessage) {
        messageIds.push(
          await enqueueStatusMessage(client, {
            kind: refundPending ? "CANCELLED_PAID" : "CANCELLED_UNPAID",
            eventId: event.id,
            subject: { reservationId: reservation.id },
            actorAdminId: command.actorAdminId,
          }),
        );
      }
      const promotions = await promoteWaitlistDetailed(client, event.id);
      if (!sameIds(promotions, command.expectedPromotedEntryIds)) {
        throw new RollbackResult(failed("WAITLIST_CHANGED"));
      }
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_CANCELLED",
        entityType: "RESERVATION",
        entityId: reservation.id,
        metadata: {
          eventId: event.id,
          stage: reservation.stage,
          partySize: reservation.party_size,
          refundPending,
          promotedCount: promotions.length,
        },
      });
      messageIds.push(...promotions.map((promotion) => promotion.messageId));
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(reservation),
        messageIds,
        promoted: promotedGuests(promotions),
        refundPending,
      };
    }) as Promise<GuestMutationResult<{ refundPending: boolean }>>;
  }

  async markRefunded(command: MarkRefundedCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (
        !reservation ||
        reservation.status !== "CANCELLED" ||
        reservation.stage !== "PAID" ||
        reservation.refund_status !== "PENDING"
      ) {
        return failed("INVALID_STAGE");
      }
      await client.query(
        `UPDATE reservations
            SET refund_status = 'REFUNDED', refunded_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [reservation.id],
      );
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_REFUNDED",
        entityType: "RESERVATION",
        entityId: reservation.id,
        metadata: {
          eventId: event.id,
          stage: reservation.stage,
          partySize: reservation.party_size,
        },
      });
      const messageIds: string[] = [];
      if (command.sendMessage) {
        messageIds.push(
          await enqueueStatusMessage(client, {
            kind: "REFUNDED",
            eventId: event.id,
            subject: { reservationId: reservation.id },
            actorAdminId: command.actorAdminId,
          }),
        );
      }
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(reservation),
        messageIds,
        promoted: [],
      };
    }) as Promise<GuestMutationResult>;
  }

  async update(command: UpdateReservationCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (!reservation || !["CONFIRMED", "CANCELLED"].includes(reservation.status)) {
        return failed("INVALID_STAGE");
      }
      const duplicate = await duplicateHandle(client, event.id, command.fields, {
        reservationId: reservation.id,
      });
      if (duplicate) return duplicate;

      const seatDelta = command.fields.partySize - reservation.party_size;
      if (reservation.status === "CONFIRMED" && seatDelta > 0) {
        const acquired = await client.query(
          `UPDATE events
              SET reserved_seats = reserved_seats + $2, updated_at = clock_timestamp()
            WHERE id = $1
              AND reserved_seats + $2 <= capacity`,
          [event.id, seatDelta],
        );
        if (acquired.rowCount === 0) return failed("NO_SEAT");
      }

      const changed = changedFields(reservation, command.fields);
      await updateGuestData(client, "reservations", reservation.id, command.fields);
      let promotions: WaitlistPromotion[] = [];
      if (reservation.status === "CONFIRMED" && seatDelta < 0) {
        await client.query(
          `UPDATE events
              SET reserved_seats = reserved_seats + $2, updated_at = clock_timestamp()
            WHERE id = $1`,
          [event.id, seatDelta],
        );
        promotions = await promoteWaitlistDetailed(client, event.id);
      }
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_UPDATED",
        entityType: "RESERVATION",
        entityId: reservation.id,
        metadata: { eventId: event.id, changedFields: changed },
      });
      return {
        ok: true,
        eventId: event.id,
        guests: [command.fields.guest1Name, command.fields.guest2Name].filter(
          (name): name is string => name !== null,
        ),
        messageIds: promotions.map((promotion) => promotion.messageId),
        promoted: promotedGuests(promotions),
      };
    }) as Promise<GuestMutationResult>;
  }

  async updateEntry(command: UpdateWaitlistEntryCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForWaitlist(client, command.entryId);
      if (!event) return failed("INVALID_STAGE");
      const entry = await lockWaitlistEntry(client, command.entryId);
      if (!entry || entry.status !== "WAITING") return failed("INVALID_STAGE");
      const duplicate = await duplicateHandle(client, event.id, command.fields, {
        entryId: entry.id,
      });
      if (duplicate) return duplicate;
      const changed = changedFields(entry, command.fields);
      await updateGuestData(client, "waitlist_entries", entry.id, command.fields);
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "WAITLIST_UPDATED",
        entityType: "WAITLIST_ENTRY",
        entityId: entry.id,
        metadata: { eventId: event.id, changedFields: changed },
      });
      return {
        ok: true,
        eventId: event.id,
        guests: [command.fields.guest1Name, command.fields.guest2Name].filter(
          (name): name is string => name !== null,
        ),
        messageIds: [],
        promoted: [],
      };
    }) as Promise<GuestMutationResult>;
  }

  async moveEntry(command: MoveWaitlistEntryCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForWaitlist(client, command.entryId);
      if (!event) return failed("INVALID_STAGE");
      const entry = await lockWaitlistEntry(client, command.entryId);
      if (!entry || entry.status !== "WAITING") return failed("INVALID_STAGE");
      const comparison = command.direction === "UP" ? "<" : ">";
      const order = command.direction === "UP" ? "DESC" : "ASC";
      const neighbourResult = await client.query<WaitlistRow>(
        `SELECT id, event_id, status, waitlist_number, full_name, instagram_handle,
                guest2_full_name, guest2_instagram_handle, party_size, allergies, notes
           FROM waitlist_entries
          WHERE event_id = $1
            AND status = 'WAITING'
            AND waitlist_number ${comparison} $2
          ORDER BY waitlist_number ${order}
          LIMIT 1
          FOR UPDATE`,
        [event.id, entry.waitlist_number],
      );
      const neighbour = neighbourResult.rows[0];
      if (!neighbour) return failed("AT_EDGE");
      await client.query("UPDATE waitlist_entries SET waitlist_number = $2 WHERE id = $1", [
        entry.id,
        -entry.waitlist_number,
      ]);
      await client.query("UPDATE waitlist_entries SET waitlist_number = $2 WHERE id = $1", [
        neighbour.id,
        entry.waitlist_number,
      ]);
      await client.query(
        `UPDATE waitlist_entries
            SET waitlist_number = $2, updated_at = clock_timestamp()
          WHERE id = $1`,
        [entry.id, neighbour.waitlist_number],
      );
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "WAITLIST_REORDERED",
        entityType: "WAITLIST_ENTRY",
        entityId: entry.id,
        metadata: {
          eventId: event.id,
          direction: command.direction,
          from: entry.waitlist_number,
          to: neighbour.waitlist_number,
        },
      });
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(entry),
        messageIds: [],
        promoted: [],
      };
    }) as Promise<GuestMutationResult>;
  }

  async promoteEntry(command: WaitlistEntryCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForWaitlist(client, command.entryId);
      if (!event) return failed("INVALID_STAGE");
      const result = await promoteSpecificWaitlistEntry(
        client,
        event.id,
        command.entryId,
        command.actorAdminId,
      );
      if (!result.ok)
        return failed(result.code === "DUPLICATE_HANDLE" ? "DUPLICATE_HANDLE" : result.code);
      return {
        ok: true,
        eventId: event.id,
        guests: result.promotion.guests,
        messageIds: [result.promotion.messageId],
        promoted: promotedGuests([result.promotion]),
      };
    }) as Promise<GuestMutationResult>;
  }

  async removeEntry(command: RemoveWaitlistEntryCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForWaitlist(client, command.entryId);
      if (!event) return failed("INVALID_STAGE");
      const entry = await lockWaitlistEntry(client, command.entryId);
      if (!entry || entry.status !== "WAITING") return failed("INVALID_STAGE");
      await client.query(
        `UPDATE waitlist_entries
            SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [entry.id],
      );
      await client.query(
        `UPDATE events
            SET waitlisted_count = waitlisted_count - 1, updated_at = clock_timestamp()
          WHERE id = $1`,
        [event.id],
      );
      const messageIds: string[] = [];
      if (command.sendMessage) {
        messageIds.push(
          await enqueueStatusMessage(client, {
            kind: "REJECTED",
            eventId: event.id,
            subject: { waitlistEntryId: entry.id },
            actorAdminId: command.actorAdminId,
          }),
        );
      }
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "WAITLIST_CANCELLED",
        entityType: "WAITLIST_ENTRY",
        entityId: entry.id,
        metadata: { eventId: event.id, partySize: entry.party_size },
      });
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(entry),
        messageIds,
        promoted: [],
      };
    }) as Promise<GuestMutationResult>;
  }

  async addRequest(
    command: AddRequestCommand,
  ): Promise<GuestMutationResult<{ placement: "LIST" | "QUEUE"; position: number | null }>> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEvent(client, command.eventId);
      if (!event || ["CANCELLED", "COMPLETED"].includes(event.status)) {
        return failed("EVENT_NOT_EDITABLE");
      }
      const currentTime = await client.query<{ editable: boolean }>(
        "SELECT $1::timestamptz > clock_timestamp() AS editable",
        [event.starts_at],
      );
      if (!currentTime.rows[0]!.editable) return failed("EVENT_NOT_EDITABLE");
      const duplicate = await duplicateHandle(client, event.id, command.fields);
      if (duplicate) return duplicate;

      const seats = await client.query<{ last_reservation_number: number; accepted_at: Date }>(
        `UPDATE events
            SET reserved_seats = reserved_seats + $2,
                last_reservation_number = last_reservation_number + 1,
                updated_at = clock_timestamp()
          WHERE id = $1
            AND reserved_seats + $2 <= capacity
          RETURNING last_reservation_number, clock_timestamp() AS accepted_at`,
        [event.id, command.fields.partySize],
      );
      const acquired = seats.rows[0];
      if (acquired) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO reservations (
             event_id, reservation_number, status, stage,
             full_name, instagram_handle, guest2_full_name, guest2_instagram_handle,
             party_size, notes, allergies, terms_accepted_at, link_code,
             source, created_by, idempotency_key, submitted_at, accepted_at
           )
           VALUES ($1, $2, 'CONFIRMED', 'IN_REVIEW', $3, $4, $5, $6,
                   $7, $8, $9, NULL, $10, 'ADMIN', $11, $12,
                   transaction_timestamp(), $13)
           RETURNING id`,
          [
            event.id,
            acquired.last_reservation_number,
            command.fields.guest1Name,
            command.fields.guest1Instagram,
            command.fields.guest2Name,
            command.fields.guest2Instagram,
            command.fields.partySize,
            command.fields.notes,
            command.fields.allergies,
            command.linkCode,
            command.actorAdminId,
            command.idempotencyKey,
            acquired.accepted_at,
          ],
        );
        const reservationId = inserted.rows[0]!.id;
        await insertAudit(client, {
          actorAdminId: command.actorAdminId,
          action: "RESERVATION_CREATED",
          entityType: "RESERVATION",
          entityId: reservationId,
          metadata: {
            eventId: event.id,
            reservationNumber: acquired.last_reservation_number,
            stage: "IN_REVIEW",
            partySize: command.fields.partySize,
          },
        });
        return {
          ok: true,
          eventId: event.id,
          guests: [command.fields.guest1Name, command.fields.guest2Name].filter(
            (name): name is string => name !== null,
          ),
          messageIds: [],
          promoted: [],
          placement: "LIST" as const,
          position: null,
        };
      }

      const place = await client.query<{ last_waitlist_number: number; waitlisted_count: number }>(
        `UPDATE events
            SET waitlisted_count = waitlisted_count + 1,
                last_waitlist_number = last_waitlist_number + 1,
                updated_at = clock_timestamp()
          WHERE id = $1
            AND waitlisted_count < waitlist_capacity
          RETURNING last_waitlist_number, waitlisted_count`,
        [event.id],
      );
      const queued = place.rows[0];
      if (!queued) return failed("NO_SPACE");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO waitlist_entries (
           event_id, waitlist_number, status,
           full_name, instagram_handle, guest2_full_name, guest2_instagram_handle,
           party_size, notes, allergies, terms_accepted_at, link_code,
           source, created_by, idempotency_key, submitted_at
         )
         VALUES ($1, $2, 'WAITING', $3, $4, $5, $6, $7, $8, $9,
                 NULL, $10, 'ADMIN', $11, $12, transaction_timestamp())
         RETURNING id`,
        [
          event.id,
          queued.last_waitlist_number,
          command.fields.guest1Name,
          command.fields.guest1Instagram,
          command.fields.guest2Name,
          command.fields.guest2Instagram,
          command.fields.partySize,
          command.fields.notes,
          command.fields.allergies,
          command.linkCode,
          command.actorAdminId,
          command.idempotencyKey,
        ],
      );
      const entryId = inserted.rows[0]!.id;
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_WAITLISTED",
        entityType: "WAITLIST_ENTRY",
        entityId: entryId,
        metadata: {
          eventId: event.id,
          waitlistNumber: queued.last_waitlist_number,
          partySize: command.fields.partySize,
        },
      });
      return {
        ok: true,
        eventId: event.id,
        guests: [command.fields.guest1Name, command.fields.guest2Name].filter(
          (name): name is string => name !== null,
        ),
        messageIds: [],
        promoted: [],
        placement: "QUEUE" as const,
        position: queued.waitlisted_count,
      };
    }) as Promise<GuestMutationResult<{ placement: "LIST" | "QUEUE"; position: number | null }>>;
  }
}

export const postgresGuestAdminRepository = new PostgresGuestAdminRepository();
