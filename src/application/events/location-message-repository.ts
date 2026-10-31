import type { LoadedLocationVersion } from "./types";

export interface LocationDeliverySummary {
  // Reservations that are CONFIRMED with stage PAID.
  paid: number;
  // Current revision SENT, READ or SENT_MANUALLY.
  received: number;
  // Current revision WAITING_CONTACT, WAITING_WINDOW or QUEUED.
  pending: number;
  failed: number;
  // No live message for the current revision and no older revision delivered either.
  neverQueued: number;
  // No live message for the current revision, but an older revision was delivered.
  outdated: number;
  lastDeliveredAt: Date | null;
}

export type SendLocationError =
  | "EVENT_NOT_FOUND"
  | "LOCATION_NOT_CONFIRMED"
  | "LOCATION_CHANGED"
  | "LOCATION_TOO_LONG"
  | "TRY_AGAIN";

export type SendLocationToPaidGuestsResult =
  | { ok: true; messageIds: string[]; locationRevision: number }
  | { ok: false; error: SendLocationError };

export type QueueLocationMessageResult =
  | { outcome: "QUEUED"; messageId: string }
  | { outcome: "ALREADY_QUEUED" }
  | { outcome: "NOT_APPLICABLE" }
  | { outcome: "TOO_LONG" };

export interface LocationMessageRepository {
  sendLocationToPaidGuests(
    eventId: string,
    expectedLocation: LoadedLocationVersion,
    adminId: string,
  ): Promise<SendLocationToPaidGuestsResult>;
  getLocationDeliverySummary(eventId: string): Promise<LocationDeliverySummary>;
}
