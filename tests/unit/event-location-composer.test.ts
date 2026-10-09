import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { EmailOutboxRow } from "@/application/notifications/email-outbox";
import { PostgresOutboxEmailComposer } from "@/infrastructure/email/outbox/outbox-email-composer";

function row(overrides: Partial<EmailOutboxRow> = {}): EmailOutboxRow {
  return {
    id: "outbox-1",
    kind: "EVENT_LOCATION",
    reservationId: "reservation-1",
    waitlistEntryId: null,
    adminUserId: null,
    locationRevision: 2,
    payload: { isUpdate: false },
    status: "PENDING",
    attempts: 1,
    nextAttemptAt: new Date(),
    lockedUntil: new Date(),
    lastError: null,
    sentAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function guest(overrides: Record<string, unknown> = {}) {
  return {
    email: "ana@example.com",
    full_name: "Ana",
    party_size: 2,
    starts_at: new Date("2026-11-14T02:00:00.000Z"),
    reservation_number: 12,
    reservation_status: "CONFIRMED",
    location_name: "Casa",
    location_address: "Calle 1",
    location_maps_url: null,
    location_notes: null,
    location_status: "CONFIRMED",
    location_revision: 2,
    image_tokens: [],
    ...overrides,
  };
}

function composer(record: Record<string, unknown>): PostgresOutboxEmailComposer {
  const pool = { query: vi.fn().mockResolvedValue({ rows: [record] }) };
  return new PostgresOutboxEmailComposer(pool as unknown as Pool);
}

describe("EVENT_LOCATION composer outcomes", () => {
  it("fails permanently when the reservation is no longer confirmed", async () => {
    await expect(
      composer(guest({ reservation_status: "CANCELLED" })).compose(row()),
    ).rejects.toMatchObject({ code: "RESERVATION_NOT_CONFIRMED" });
  });

  it("fails permanently when the location is no longer confirmed", async () => {
    await expect(
      composer(guest({ location_status: "PENDING" })).compose(row()),
    ).rejects.toMatchObject({ code: "LOCATION_NOT_CONFIRMED" });
  });

  it("fails permanently when a newer location revision exists", async () => {
    await expect(composer(guest({ location_revision: 3 })).compose(row())).rejects.toMatchObject({
      code: "LOCATION_SUPERSEDED",
    });
  });
});
