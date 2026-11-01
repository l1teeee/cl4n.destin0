import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PermanentEmailCompositionError } from "@/application/notifications/email-delivery-error";
import { classifyEmailDeliveryFailure } from "@/application/notifications/email-delivery-policy";
import {
  emailOutboxKinds,
  isRetiredGuestEmailKind,
  type EmailOutboxKind,
  type EmailOutboxRow,
} from "@/application/notifications/email-outbox";
import { PostgresOutboxEmailComposer } from "@/infrastructure/email/outbox/outbox-email-composer";

const retiredKinds = [
  "RESERVATION_CONFIRMED",
  "RESERVATION_WAITLISTED",
  "WAITLIST_PROMOTED",
  "RESERVATION_CANCELLED",
  "WAITLIST_CANCELLED",
  "EVENT_LOCATION",
] as const satisfies readonly EmailOutboxKind[];

function row(kind: EmailOutboxKind, overrides: Partial<EmailOutboxRow> = {}): EmailOutboxRow {
  return {
    id: "outbox-1",
    kind,
    reservationId: "reservation-1",
    waitlistEntryId: null,
    adminUserId: null,
    locationRevision: kind === "EVENT_LOCATION" ? 2 : null,
    payload: {},
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

describe("retired guest email kinds", () => {
  it("covers exactly the guest kinds and none of the admin kinds", () => {
    const retired = emailOutboxKinds.filter((kind) => isRetiredGuestEmailKind(kind));

    expect(retired).toEqual(retiredKinds);
  });

  it.each(retiredKinds)(
    "fails composing %s permanently with KIND_RETIRED without reading the subject",
    async (kind) => {
      const query = vi.fn();
      const composer = new PostgresOutboxEmailComposer({ query } as unknown as Pool);

      await expect(composer.compose(row(kind))).rejects.toMatchObject({
        name: "PermanentEmailCompositionError",
        code: "KIND_RETIRED",
      });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("is a permanent failure for the delivery policy, so a retry never loops", () => {
    expect(
      classifyEmailDeliveryFailure(new PermanentEmailCompositionError("KIND_RETIRED"), 1),
    ).toEqual({ action: "FAIL", errorCode: "KIND_RETIRED" });
  });
});
