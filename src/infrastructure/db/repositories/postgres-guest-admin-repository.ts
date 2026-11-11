import type { Pool, PoolClient } from "pg";

import type {
  AddRequestCommand,
  CancelReservationCommand,
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
import type { RequestGuest } from "@/domain/reservation/request-guests";
import { generateLinkCode as defaultGenerateLinkCode } from "@/infrastructure/crypto/link-code-generator";

import { pool as applicationPool } from "../client";
import { queueLocationMessage } from "./postgres-location-message-repository";
import { enqueueStatusMessage } from "./status-messages";
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
  max_party_size: number;
  deleted_at: Date | null;
}

interface ReservationRow {
  id: string;
  event_id: string;
  status: "SUBMITTED" | "CONFIRMED" | "FULL_REJECTED" | "CANCELLED" | "EXPIRED";
  stage: "IN_REVIEW" | "ON_LIST" | "PAID";
  full_name: string;
  instagram_handle: string;
  companions: RequestGuest[];
  party_size: number;
  allergies: string | null;
  notes: string | null;
  refund_status: "PENDING" | "REFUNDED" | null;
}

interface WaitlistRow {
  id: string;
  event_id: string;
  status: "WAITING" | "PROMOTED" | "CANCELLED";
  waitlist_number: number;
  full_name: string;
  instagram_handle: string;
  companions: RequestGuest[];
  party_size: number;
  allergies: string | null;
  notes: string | null;
}

class RollbackResult extends Error {
  constructor(readonly result: GuestMutationFailure) {
    super(result.code);
  }
}

const linkCodeConstraints = new Set(["reservations_link_code_uq", "waitlist_entries_link_code_uq"]);

function isLinkCodeUniqueViolation(error: unknown): boolean {
  const details = error as { code?: string; constraint?: string };
  return details.code === "23505" && linkCodeConstraints.has(details.constraint ?? "");
}

function isLiveEvent(event: EventRow): boolean {
  return event.deleted_at === null && !["CANCELLED", "COMPLETED"].includes(event.status);
}

function failed(
  code: GuestMutationFailure["code"],
  details: Omit<GuestMutationFailure, "ok" | "code"> = {},
): GuestMutationFailure {
  return { ok: false, code, ...details };
}

function guestsOf(row: Pick<ReservationRow | WaitlistRow, "full_name" | "companions">) {
  return [row.full_name, ...row.companions.map((guest) => guest.name)];
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

async function promoteReplacement(
  client: PoolClient,
  eventId: string,
  command: ReleaseReservationCommand,
): Promise<WaitlistPromotion[]> {
  if (command.replacement.mode === "auto") {
    const promotions = await promoteWaitlistDetailed(client, eventId);
    if (!sameIds(promotions, command.replacement.expectedPromotedEntryIds)) {
      throw new RollbackResult(failed("WAITLIST_CHANGED"));
    }
    return promotions;
  }

  const result = await promoteSpecificWaitlistEntry(
    client,
    eventId,
    command.replacement.waitlistEntryId,
    command.actorAdminId,
  );
  if (!result.ok) {
    if (result.code === "INVALID_STAGE") {
      throw new RollbackResult(failed("WAITLIST_CHANGED"));
    }
    if (result.code === "NO_SEAT") {
      throw new RollbackResult(failed("REPLACEMENT_DOES_NOT_FIT"));
    }
    throw new RollbackResult(failed(result.code));
  }
  return [result.promotion];
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
    await client.query("SET LOCAL statement_timeout = '5s'");
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
            e.waitlist_capacity, e.waitlisted_count, e.max_party_size, e.deleted_at
       FROM reservations r
       JOIN events e ON e.id = r.event_id
      WHERE r.id = $1
      FOR UPDATE OF e`,
    [reservationId],
  );
  return result.rows[0] ?? null;
}

async function lockEventForWaitlist(client: PoolClient, entryId: string): Promise<EventRow | null> {
  const result = await client.query<EventRow>(
    `SELECT e.id, e.status, e.starts_at, e.capacity, e.reserved_seats,
            e.waitlist_capacity, e.waitlisted_count, e.max_party_size, e.deleted_at
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
            waitlist_capacity, waitlisted_count, max_party_size, deleted_at
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
            COALESCE((SELECT json_agg(json_build_object(
              'slot', slot, 'name', full_name, 'instagram', instagram_handle
            ) ORDER BY slot) FROM request_guests WHERE reservation_id = reservations.id), '[]') AS companions,
            party_size, allergies, notes, refund_status
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
            COALESCE((SELECT json_agg(json_build_object(
              'slot', slot, 'name', full_name, 'instagram', instagram_handle
            ) ORDER BY slot) FROM request_guests WHERE waitlist_entry_id = waitlist_entries.id), '[]') AS companions,
            party_size, allergies, notes
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

// The ON_LIST message still goes out without them, so this only lets the admin know.
// The event row is locked by the caller, so the price cannot change under this read.
async function isPaymentMissing(client: PoolClient, eventId: string): Promise<boolean> {
  const result = await client.query<{ missing: boolean }>(
    `SELECT NOT EXISTS (SELECT 1 FROM payment_settings WHERE id = 1)
            OR COALESCE((SELECT price_cents IS NULL FROM events WHERE id = $1), true)
            AS missing`,
    [eventId],
  );
  return result.rows[0]!.missing;
}

async function duplicateHandle(
  client: PoolClient,
  eventId: string,
  fields: GuestFields,
  exclude: { reservationId?: string; entryId?: string } = {},
): Promise<GuestMutationFailure | null> {
  const result = await client.query<{ handle: string }>(
    `SELECT handle FROM (
       SELECT r.instagram_handle AS handle
         FROM reservations r
        WHERE r.event_id = $1 AND r.status = 'CONFIRMED'
          AND r.id IS DISTINCT FROM $3::uuid
       UNION ALL
       SELECT g.instagram_handle FROM request_guests g
         JOIN reservations r ON r.id = g.reservation_id
        WHERE r.event_id = $1 AND r.status = 'CONFIRMED'
          AND r.id IS DISTINCT FROM $3::uuid
       UNION ALL
       SELECT w.instagram_handle FROM waitlist_entries w
        WHERE w.event_id = $1 AND w.status = 'WAITING'
          AND w.id IS DISTINCT FROM $4::uuid
       UNION ALL
       SELECT g.instagram_handle FROM request_guests g
         JOIN waitlist_entries w ON w.id = g.waitlist_entry_id
        WHERE w.event_id = $1 AND w.status = 'WAITING'
          AND w.id IS DISTINCT FROM $4::uuid
     ) active_handles
     WHERE handle = ANY($2::text[])`,
    [
      eventId,
      fields.guests.map((guest) => guest.instagram),
      exclude.reservationId ?? null,
      exclude.entryId ?? null,
    ],
  );
  const handles = new Set(result.rows.map((row) => row.handle));
  const index = fields.guests.findIndex((guest) => handles.has(guest.instagram));
  return index < 0
    ? null
    : {
        ok: false,
        code: "DUPLICATE_HANDLE",
        field: `guests.${index}.instagram`,
      };
}

function changedFields(row: ReservationRow | WaitlistRow, fields: GuestFields): string[] {
  const changed: string[] = [];
  if (row.party_size !== fields.guests.length) changed.push("partySize");
  const previous = [
    { slot: 1, name: row.full_name, instagram: row.instagram_handle },
    ...row.companions,
  ];
  for (let index = 0; index < Math.max(previous.length, fields.guests.length); index += 1) {
    if (previous[index]?.name !== fields.guests[index]?.name) changed.push(`guests.${index}.name`);
    if (previous[index]?.instagram !== fields.guests[index]?.instagram) {
      changed.push(`guests.${index}.instagram`);
    }
  }
  if ((row.allergies !== null) !== fields.hasAllergies) changed.push("hasAllergies");
  if (row.allergies !== fields.allergies) changed.push("allergies");
  if (row.notes !== fields.notes) changed.push("notes");
  return changed;
}

async function updateCompanions(
  client: PoolClient,
  table: "reservations" | "waitlist_entries",
  id: string,
  guests: GuestFields["guests"],
): Promise<void> {
  const column = table === "reservations" ? "reservation_id" : "waitlist_entry_id";
  await client.query(`DELETE FROM request_guests WHERE ${column} = $1 AND slot > $2`, [
    id,
    guests.length,
  ]);
  for (const [index, guest] of guests.entries()) {
    if (index === 0) continue;
    await client.query(
      `INSERT INTO request_guests (${column}, slot, full_name, instagram_handle)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (${column}, slot) DO UPDATE
         SET full_name = EXCLUDED.full_name,
             instagram_handle = EXCLUDED.instagram_handle,
             contact_id = CASE WHEN request_guests.instagram_handle = EXCLUDED.instagram_handle
               THEN request_guests.contact_id ELSE NULL END`,
      [id, index + 1, guest.name, guest.instagram],
    );
  }
}

async function updateGuestData(
  client: PoolClient,
  table: "reservations" | "waitlist_entries",
  id: string,
  fields: GuestFields,
  previousCompanions: RequestGuest[],
  actorAdminId: string,
): Promise<void> {
  await client.query(
    `UPDATE ${table}
        SET party_size = $2, full_name = $3, instagram_handle = $4,
            allergies = $5, notes = $6, updated_at = clock_timestamp()
      WHERE id = $1`,
    [
      id,
      fields.guests.length,
      fields.guests[0]!.name,
      fields.guests[0]!.instagram,
      fields.allergies,
      fields.notes,
    ],
  );
  await updateCompanions(client, table, id, fields.guests);
  if (table !== "reservations") return;

  await client.query(
    `UPDATE messages
        SET status = 'DISCARDED', handled_by = $3, locked_until = NULL,
            claims_without_progress = 0
      WHERE reservation_id = $1 AND guest_slot > $2
        AND status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED', 'FAILED')
        AND NOT (
          status = 'QUEUED' AND locked_until IS NOT NULL AND locked_until > clock_timestamp()
        )`,
    [id, fields.guests.length, actorAdminId],
  );
  const changedSlots = previousCompanions
    .filter((guest) => {
      const current = fields.guests[guest.slot - 1];
      return current && current.instagram !== guest.instagram;
    })
    .map((guest) => guest.slot);
  await client.query(
    `UPDATE messages
        SET contact_id = NULL, status = 'WAITING_CONTACT',
            parts_sent = 0, external_part_ids = NULL, attempts = 0,
            claims_without_progress = 0, locked_until = NULL, last_error = NULL
      WHERE reservation_id = $1 AND guest_slot = ANY($2::smallint[])
        AND status IN ('WAITING_CONTACT', 'WAITING_WINDOW', 'QUEUED', 'FAILED')
        AND NOT (
          status = 'QUEUED' AND locked_until IS NOT NULL AND locked_until > clock_timestamp()
        )`,
    [id, changedSlots],
  );
}

async function insertWithFreshLinkCode<T>(
  client: PoolClient,
  generateLinkCode: () => string,
  insert: (linkCode: string) => Promise<T | null>,
): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const linkCode = generateLinkCode();
    const collision = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM reservations WHERE link_code = $1
         UNION ALL
         SELECT 1 FROM waitlist_entries WHERE link_code = $1
       ) AS exists`,
      [linkCode],
    );
    if (collision.rows[0]!.exists) continue;

    await client.query("SAVEPOINT admin_link_code_attempt");
    try {
      const inserted = await insert(linkCode);
      await client.query("RELEASE SAVEPOINT admin_link_code_attempt");
      if (inserted) return inserted;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT admin_link_code_attempt");
      await client.query("RELEASE SAVEPOINT admin_link_code_attempt");
      if (isLinkCodeUniqueViolation(error)) continue;
      throw error;
    }
  }
  return null;
}

export class PostgresGuestAdminRepository implements GuestAdminRepository {
  constructor(
    private readonly pool: Pool = applicationPool,
    private readonly generateLinkCode: () => string = defaultGenerateLinkCode,
  ) {}

  async accept(
    command: ReservationCommand,
  ): Promise<GuestMutationResult<{ paymentMissing: boolean }>> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      if (!isLiveEvent(event)) return failed("EVENT_NOT_EDITABLE");
      const reservation = await lockReservation(client, command.reservationId);
      if (!reservation || reservation.status !== "CONFIRMED" || reservation.stage !== "IN_REVIEW") {
        return failed("INVALID_STAGE");
      }
      const paymentMissing = await isPaymentMissing(client, event.id);
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
        paymentMissing,
      };
    }) as Promise<GuestMutationResult<{ paymentMissing: boolean }>>;
  }

  async verifyPayment(command: VerifyPaymentCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event) return failed("INVALID_STAGE");
      if (!isLiveEvent(event)) return failed("EVENT_NOT_EDITABLE");
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
      const messageIds = [
        await enqueueStatusMessage(client, {
          kind: "PAID",
          eventId: event.id,
          subject: { reservationId: reservation.id },
          actorAdminId: command.actorAdminId,
        }),
      ];
      // The event row lock is held, so the location revision cannot change under this insert. A
      // location that is pending, missing or too long never blocks the payment.
      const location = await queueLocationMessage(client, event.id, reservation.id);
      if (location.outcome === "QUEUED") {
        messageIds.push(location.messageId);
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

  async reject(command: ReleaseReservationCommand): Promise<GuestMutationResult> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event || event.deleted_at) return failed("INVALID_STAGE");
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
      const promotions = await promoteReplacement(client, event.id, command);
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
          replacementMode: command.replacement.mode,
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
    command: CancelReservationCommand,
  ): Promise<GuestMutationResult<{ refundPending: boolean }>> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEventForReservation(client, command.reservationId);
      if (!event || event.deleted_at) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (
        !reservation ||
        reservation.status !== "CONFIRMED" ||
        reservation.stage !== command.expectedStage
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
      const promotions = await promoteReplacement(client, event.id, command);
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
          replacementMode: command.replacement.mode,
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
      if (!event || event.deleted_at) return failed("INVALID_STAGE");
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
      if (!event || event.deleted_at) return failed("INVALID_STAGE");
      const reservation = await lockReservation(client, command.reservationId);
      if (!reservation || !["CONFIRMED", "CANCELLED"].includes(reservation.status)) {
        return failed("INVALID_STAGE");
      }
      if (
        command.fields.guests.length > reservation.party_size &&
        command.fields.guests.length > event.max_party_size
      ) {
        return failed("PARTY_SIZE_NOT_ALLOWED", { maxPartySize: event.max_party_size });
      }
      if (reservation.status === "CONFIRMED") {
        const duplicate = await duplicateHandle(client, event.id, command.fields, {
          reservationId: reservation.id,
        });
        if (duplicate) return duplicate;
      }

      const seatDelta = command.fields.guests.length - reservation.party_size;
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
      await updateGuestData(
        client,
        "reservations",
        reservation.id,
        command.fields,
        reservation.companions,
        command.actorAdminId,
      );
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
        guests: command.fields.guests.map((guest) => guest.name),
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
      if (
        command.fields.guests.length > entry.party_size &&
        command.fields.guests.length > event.max_party_size
      ) {
        return failed("PARTY_SIZE_NOT_ALLOWED", { maxPartySize: event.max_party_size });
      }
      const duplicate = await duplicateHandle(client, event.id, command.fields, {
        entryId: entry.id,
      });
      if (duplicate) return duplicate;
      const changed = changedFields(entry, command.fields);
      await updateGuestData(
        client,
        "waitlist_entries",
        entry.id,
        command.fields,
        entry.companions,
        command.actorAdminId,
      );
      const promotions = await promoteWaitlistDetailed(client, event.id);
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
        guests: command.fields.guests.map((guest) => guest.name),
        messageIds: promotions.map((promotion) => promotion.messageId),
        promoted: promotedGuests(promotions),
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
                COALESCE((SELECT json_agg(json_build_object(
              'slot', slot, 'name', full_name, 'instagram', instagram_handle
            ) ORDER BY slot) FROM request_guests WHERE waitlist_entry_id = waitlist_entries.id), '[]') AS companions,
            party_size, allergies, notes
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
      await client.query(
        `UPDATE waitlist_entries
            SET waitlist_number = $2, updated_at = clock_timestamp()
          WHERE id = $1`,
        [entry.id, -entry.waitlist_number],
      );
      await client.query(
        `UPDATE waitlist_entries
            SET waitlist_number = $2, updated_at = clock_timestamp()
          WHERE id = $1`,
        [neighbour.id, entry.waitlist_number],
      );
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
      const promotions = await promoteWaitlistDetailed(client, event.id);
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(entry),
        messageIds: promotions.map((promotion) => promotion.messageId),
        promoted: promotedGuests(promotions),
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
      if (!result.ok) return failed(result.code);
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
      const promotions = await promoteWaitlistDetailed(client, event.id);
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
        metadata: {
          eventId: event.id,
          partySize: entry.party_size,
          promotedCount: promotions.length,
        },
      });
      messageIds.push(...promotions.map((promotion) => promotion.messageId));
      return {
        ok: true,
        eventId: event.id,
        guests: guestsOf(entry),
        messageIds,
        promoted: promotedGuests(promotions),
      };
    }) as Promise<GuestMutationResult>;
  }

  async addRequest(
    command: AddRequestCommand,
  ): Promise<GuestMutationResult<{ placement: "LIST" | "QUEUE"; position: number | null }>> {
    return runTransaction(this.pool, async (client) => {
      const event = await lockEvent(client, command.eventId);
      if (!event || !isLiveEvent(event)) return failed("EVENT_NOT_EDITABLE");
      const currentTime = await client.query<{ editable: boolean }>(
        "SELECT $1::timestamptz > clock_timestamp() AS editable",
        [event.starts_at],
      );
      if (!currentTime.rows[0]!.editable) return failed("EVENT_NOT_EDITABLE");
      if (command.fields.guests.length > event.max_party_size) {
        return failed("PARTY_SIZE_NOT_ALLOWED", { maxPartySize: event.max_party_size });
      }
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
        [event.id, command.fields.guests.length],
      );
      const acquired = seats.rows[0];
      if (acquired) {
        const inserted = await insertWithFreshLinkCode(
          client,
          this.generateLinkCode,
          async (linkCode) => {
            const result = await client.query<{ id: string }>(
              `INSERT INTO reservations (
                 event_id, reservation_number, status, stage,
                 full_name, instagram_handle,
                 party_size, notes, allergies, terms_accepted_at, link_code,
                 source, created_by, idempotency_key, submitted_at, accepted_at
               )
               SELECT $1, $2, 'CONFIRMED', 'IN_REVIEW', $3, $4,
                      $5, $6, $7, NULL, $8, 'ADMIN', $9, $10,
                      transaction_timestamp(), $11
                WHERE NOT EXISTS (
                  SELECT 1 FROM waitlist_entries WHERE link_code = $8
                )
               RETURNING id`,
              [
                event.id,
                acquired.last_reservation_number,
                command.fields.guests[0]!.name,
                command.fields.guests[0]!.instagram,
                command.fields.guests.length,
                command.fields.notes,
                command.fields.allergies,
                linkCode,
                command.actorAdminId,
                command.idempotencyKey,
                acquired.accepted_at,
              ],
            );
            return result.rows[0] ?? null;
          },
        );
        if (!inserted) throw new RollbackResult(failed("TRY_AGAIN"));
        const reservationId = inserted.id;
        await updateCompanions(client, "reservations", reservationId, command.fields.guests);
        await insertAudit(client, {
          actorAdminId: command.actorAdminId,
          action: "RESERVATION_CREATED",
          entityType: "RESERVATION",
          entityId: reservationId,
          metadata: {
            eventId: event.id,
            reservationNumber: acquired.last_reservation_number,
            stage: "IN_REVIEW",
            partySize: command.fields.guests.length,
          },
        });
        return {
          ok: true,
          eventId: event.id,
          guests: command.fields.guests.map((guest) => guest.name),
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
      const inserted = await insertWithFreshLinkCode(
        client,
        this.generateLinkCode,
        async (linkCode) => {
          const result = await client.query<{ id: string }>(
            `INSERT INTO waitlist_entries (
               event_id, waitlist_number, status,
               full_name, instagram_handle,
               party_size, notes, allergies, terms_accepted_at, link_code,
               source, created_by, idempotency_key, submitted_at
             )
             SELECT $1, $2, 'WAITING', $3, $4, $5, $6, $7,
                    NULL, $8, 'ADMIN', $9, $10, transaction_timestamp()
              WHERE NOT EXISTS (
                SELECT 1 FROM reservations WHERE link_code = $8
              )
             RETURNING id`,
            [
              event.id,
              queued.last_waitlist_number,
              command.fields.guests[0]!.name,
              command.fields.guests[0]!.instagram,
              command.fields.guests.length,
              command.fields.notes,
              command.fields.allergies,
              linkCode,
              command.actorAdminId,
              command.idempotencyKey,
            ],
          );
          return result.rows[0] ?? null;
        },
      );
      if (!inserted) throw new RollbackResult(failed("TRY_AGAIN"));
      const entryId = inserted.id;
      await updateCompanions(client, "waitlist_entries", entryId, command.fields.guests);
      await insertAudit(client, {
        actorAdminId: command.actorAdminId,
        action: "RESERVATION_WAITLISTED",
        entityType: "WAITLIST_ENTRY",
        entityId: entryId,
        metadata: {
          eventId: event.id,
          waitlistNumber: queued.last_waitlist_number,
          partySize: command.fields.guests.length,
        },
      });
      return {
        ok: true,
        eventId: event.id,
        guests: command.fields.guests.map((guest) => guest.name),
        messageIds: [],
        promoted: [],
        placement: "QUEUE" as const,
        position: queued.waitlisted_count,
      };
    }) as Promise<GuestMutationResult<{ placement: "LIST" | "QUEUE"; position: number | null }>>;
  }
}

export const postgresGuestAdminRepository = new PostgresGuestAdminRepository();
