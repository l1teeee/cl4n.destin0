import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetTestDatabase, testDatabaseUrl } from "../helpers/test-db";

interface EventInput {
  slug: string;
  capacity: number;
  reservedSeats: number;
  maxPartySize: number;
  opensAt: Date;
  closesAt: Date;
}

interface ReservationInput {
  reservationNumber: number | null;
  status: "SUBMITTED" | "CONFIRMED" | "FULL_REJECTED" | "CANCELLED" | "EXPIRED";
  phoneE164: string;
  email: string;
  emailNormalized: string;
  partySize: number;
  idempotencyKey: string;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
}

let pool: Pool;
let reservationNumber = 0;

function validEvent(overrides: Partial<EventInput> = {}): EventInput {
  return {
    slug: `event-${randomUUID()}`,
    capacity: 10,
    reservedSeats: 0,
    maxPartySize: 4,
    opensAt: new Date("2030-01-01T00:00:00.000Z"),
    closesAt: new Date("2030-01-01T02:00:00.000Z"),
    ...overrides,
  };
}

async function insertEvent(overrides: Partial<EventInput> = {}): Promise<string> {
  const event = validEvent(overrides);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug,
       internal_name,
       starts_at,
       capacity,
       reserved_seats,
       max_party_size,
       opens_at,
       closes_at
     )
     VALUES ($1, 'Integrity Test Event', $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      event.slug,
      new Date("2030-01-02T00:00:00.000Z"),
      event.capacity,
      event.reservedSeats,
      event.maxPartySize,
      event.opensAt,
      event.closesAt,
    ],
  );

  return result.rows[0]!.id;
}

function validReservation(overrides: Partial<ReservationInput> = {}): ReservationInput {
  reservationNumber += 1;
  const contactId = randomUUID();

  return {
    reservationNumber,
    status: "CONFIRMED",
    phoneE164: `+503${reservationNumber.toString().padStart(8, "0")}`,
    email: `${contactId}@example.com`,
    emailNormalized: `${contactId}@example.com`,
    partySize: 1,
    idempotencyKey: randomUUID(),
    acceptedAt: new Date(),
    cancelledAt: null,
    ...overrides,
  };
}

async function insertReservation(
  eventId: string,
  overrides: Partial<ReservationInput> = {},
): Promise<string> {
  const reservation = validReservation(overrides);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO reservations (
       event_id,
       reservation_number,
       status,
       full_name,
       instagram_handle,
       phone_e164,
       email,
       email_normalized,
       party_size,
       terms_accepted_at,
       idempotency_key,
       submitted_at,
       accepted_at,
       cancelled_at
     )
     VALUES ($1, $2, $3, 'Integrity Test Guest', 'integrity-test', $4, $5, $6, $7,
       now(), $8, now(), $9, $10)
     RETURNING id`,
    [
      eventId,
      reservation.reservationNumber,
      reservation.status,
      reservation.phoneE164,
      reservation.email,
      reservation.emailNormalized,
      reservation.partySize,
      reservation.idempotencyKey,
      reservation.acceptedAt,
      reservation.cancelledAt,
    ],
  );

  return result.rows[0]!.id;
}

async function expectConstraintViolation(
  operation: Promise<unknown>,
  constraint: string,
): Promise<void> {
  let caught: unknown;

  try {
    await operation;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeDefined();
  expect(caught).toMatchObject({ constraint });
}

beforeAll(async () => {
  await resetTestDatabase();
  pool = new Pool({ connectionString: testDatabaseUrl().toString() });
});

afterAll(async () => {
  await pool.end();
});

describe("event constraints", () => {
  it("rejects reserved seats above capacity", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      pool.query("UPDATE events SET reserved_seats = 11 WHERE id = $1", [eventId]),
      "events_reserved_within_capacity_chk",
    );
  });

  it("rejects negative reserved seats", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      pool.query("UPDATE events SET reserved_seats = -1 WHERE id = $1", [eventId]),
      "events_reserved_within_capacity_chk",
    );
  });

  it("rejects a maximum party size above capacity", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      pool.query("UPDATE events SET max_party_size = 11 WHERE id = $1", [eventId]),
      "events_max_party_within_capacity_chk",
    );
  });

  it("rejects a close time equal to the open time", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      pool.query("UPDATE events SET closes_at = opens_at WHERE id = $1", [eventId]),
      "events_window_order_chk",
    );
  });

  it("rejects an invalid slug", async () => {
    await expectConstraintViolation(
      insertEvent({ slug: "Invalid Slug" }),
      "events_slug_format_chk",
    );
  });

  it("rejects zero capacity", async () => {
    await expectConstraintViolation(insertEvent({ capacity: 0 }), "events_capacity_positive_chk");
  });
});

describe("reservation constraints", () => {
  it("rejects a confirmed reservation without its number and accepted time", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      insertReservation(eventId, { reservationNumber: null, acceptedAt: null }),
      "reservations_confirmed_fields_chk",
    );
  });

  it("rejects a full rejection with a reservation number", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      insertReservation(eventId, {
        status: "FULL_REJECTED",
        acceptedAt: null,
      }),
      "reservations_full_rejected_fields_chk",
    );
  });

  it("rejects a cancelled reservation without a cancellation time", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      insertReservation(eventId, {
        status: "CANCELLED",
        reservationNumber: null,
        acceptedAt: null,
      }),
      "reservations_cancelled_timestamp_chk",
    );
  });

  it("rejects a party size of zero", async () => {
    const eventId = await insertEvent();

    await expectConstraintViolation(
      insertReservation(eventId, {
        status: "SUBMITTED",
        reservationNumber: null,
        partySize: 0,
        acceptedAt: null,
      }),
      "reservations_party_size_positive_chk",
    );
  });
});

describe("reservation uniqueness", () => {
  it("rejects a second confirmed reservation with the same email for one event", async () => {
    const eventId = await insertEvent();
    const email = `${randomUUID()}@example.com`;
    await insertReservation(eventId, { email, emailNormalized: email });

    await expectConstraintViolation(
      insertReservation(eventId, { email, emailNormalized: email }),
      "reservations_one_confirmed_per_email_uq",
    );
  });

  it("rejects a second confirmed reservation with the same phone for one event", async () => {
    const eventId = await insertEvent();
    const phoneE164 = "+50370000000";
    await insertReservation(eventId, { phoneE164 });

    await expectConstraintViolation(
      insertReservation(eventId, { phoneE164 }),
      "reservations_one_confirmed_per_phone_uq",
    );
  });

  it("allows confirmed, full-rejected and cancelled rows with the same email", async () => {
    const eventId = await insertEvent();
    const email = `${randomUUID()}@example.com`;
    await insertReservation(eventId, { email, emailNormalized: email });

    await expect(
      insertReservation(eventId, {
        status: "FULL_REJECTED",
        reservationNumber: null,
        email,
        emailNormalized: email,
        acceptedAt: null,
      }),
    ).resolves.toBeTypeOf("string");
    await expect(
      insertReservation(eventId, {
        status: "CANCELLED",
        reservationNumber: null,
        email,
        emailNormalized: email,
        acceptedAt: null,
        cancelledAt: new Date(),
      }),
    ).resolves.toBeTypeOf("string");
  });

  it("allows the same confirmed email on different events", async () => {
    const firstEventId = await insertEvent();
    const secondEventId = await insertEvent();
    const email = `${randomUUID()}@example.com`;
    await insertReservation(firstEventId, { email, emailNormalized: email });

    await expect(
      insertReservation(secondEventId, { email, emailNormalized: email }),
    ).resolves.toBeTypeOf("string");
  });

  it("rejects a duplicate reservation number within one event", async () => {
    const eventId = await insertEvent();
    const duplicateNumber = 9001;
    await insertReservation(eventId, { reservationNumber: duplicateNumber });

    await expectConstraintViolation(
      insertReservation(eventId, { reservationNumber: duplicateNumber }),
      "reservations_event_number_uq",
    );
  });

  it("rejects a duplicate reservation idempotency key", async () => {
    const firstEventId = await insertEvent();
    const secondEventId = await insertEvent();
    const idempotencyKey = randomUUID();
    await insertReservation(firstEventId, { idempotencyKey });

    await expectConstraintViolation(
      insertReservation(secondEventId, { idempotencyKey }),
      "reservations_idempotency_key_uq",
    );
  });
});

describe("audit log integrity", () => {
  it("requires actor_admin_id exactly for ADMIN actors", async () => {
    const entityId = await insertEvent();
    const admin = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, email_normalized, password_hash, display_name)
       VALUES ($1, $1, 'test-password-hash', 'Integrity Test Admin')
       RETURNING id`,
      [`${randomUUID()}@example.com`],
    );
    const adminId = admin.rows[0]!.id;

    await expectConstraintViolation(
      pool.query(
        `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id)
         VALUES ('ADMIN', 'EVENT_CREATED', 'EVENT', $1)`,
        [entityId],
      ),
      "audit_logs_admin_actor_chk",
    );
    await expectConstraintViolation(
      pool.query(
        `INSERT INTO audit_logs (
           actor_type,
           actor_admin_id,
           action,
           entity_type,
           entity_id
         )
         VALUES ('PUBLIC', $1, 'EVENT_CREATED', 'EVENT', $2)`,
        [adminId, entityId],
      ),
      "audit_logs_admin_actor_chk",
    );
  });

  it("rejects UPDATE, DELETE and TRUNCATE", async () => {
    const entityId = await insertEvent();
    const audit = await pool.query<{ id: string }>(
      `INSERT INTO audit_logs (actor_type, action, entity_type, entity_id)
       VALUES ('SYSTEM', 'EVENT_CREATED', 'EVENT', $1)
       RETURNING id`,
      [entityId],
    );
    const auditId = audit.rows[0]!.id;

    await expect(
      pool.query("UPDATE audit_logs SET metadata = '{\"changed\":true}' WHERE id = $1", [auditId]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(
      pool.query("DELETE FROM audit_logs WHERE id = $1", [auditId]),
    ).rejects.toMatchObject({ code: "P0001" });
    await expect(pool.query("TRUNCATE audit_logs")).rejects.toMatchObject({ code: "P0001" });
  });
});

describe("idempotency record integrity", () => {
  it("rejects completed_at without response_status", async () => {
    await expectConstraintViolation(
      pool.query(
        `INSERT INTO idempotency_records (
           key,
           scope,
           request_fingerprint,
           completed_at
         )
         VALUES ($1, 'reservation_submit', 'fingerprint', now())`,
        [randomUUID()],
      ),
      "idempotency_records_completion_chk",
    );
  });
});

describe("rate limit counter storage", () => {
  it("uses an UNLOGGED table", async () => {
    const result = await pool.query<{ relpersistence: string }>(
      `SELECT relpersistence
         FROM pg_class
        WHERE oid = 'rate_limit_counters'::regclass`,
    );

    expect(result.rows).toEqual([{ relpersistence: "u" }]);
  });
});
