import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

export interface TestEventOptions {
  status?: "DRAFT" | "SCHEDULED" | "CLOSED" | "COMPLETED" | "CANCELLED";
  capacity?: number;
  reservedSeats?: number;
  maxPartySize?: number;
  opensOffset?: string;
  closesOffset?: string;
  autoCloseOnFull?: boolean;
  waitlistCapacity?: number;
  priceCents?: number | null;
}

export interface TestEvent {
  id: string;
  slug: string;
}

export function uniqueSlug(prefix = "event"): string {
  return `${prefix}-${randomUUID()}`;
}

export async function insertTestEvent(
  pool: Pool,
  options: TestEventOptions = {},
): Promise<TestEvent> {
  const slug = uniqueSlug();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO events (
       slug, internal_name, starts_at, capacity, reserved_seats,
       max_party_size, opens_at, closes_at, auto_close_on_full,
       status, last_reservation_number, waitlist_capacity, price_cents
     )
     VALUES (
       $1, 'Reservation Engine Test', clock_timestamp() + INTERVAL '1 day',
       $2, $3, $4,
       clock_timestamp() + $5::interval,
       clock_timestamp() + $6::interval,
       $7, $8, 0, $9, $10
     )
     RETURNING id`,
    [
      slug,
      options.capacity ?? 20,
      options.reservedSeats ?? 0,
      options.maxPartySize ?? 2,
      options.opensOffset ?? "-1 hour",
      options.closesOffset ?? "1 hour",
      options.autoCloseOnFull ?? false,
      options.status ?? "SCHEDULED",
      options.waitlistCapacity ?? 0,
      options.priceCents === undefined ? 2500 : options.priceCents,
    ],
  );

  return { id: result.rows[0]!.id, slug };
}

export function reservationBody(
  eventSlug: string,
  sequence = 1,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const couple =
    overrides.partySize === 2
      ? {
          guest2Name: `Guest ${sequence} Companion`,
          guest2Instagram: `guest.${sequence}.companion`,
        }
      : {};
  return {
    eventSlug,
    guest1Name: `Guest ${sequence}`,
    guest1Instagram: `guest.${sequence}`,
    partySize: 1,
    hasAllergies: false,
    notes: "Sin observaciones",
    acceptTerms: true,
    turnstileToken: "test-token",
    ...couple,
    ...overrides,
  };
}

export const allowAllRateLimiter = {
  async consume() {
    return { allowed: true, retryAfterSeconds: 0 };
  },
};

export const allowAllBotVerifier = {
  async verify() {
    return { ok: true as const };
  },
};
