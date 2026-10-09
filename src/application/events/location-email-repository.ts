import type { LoadedLocationVersion } from "./types";

export interface EventLocationEmailSummary {
  confirmedReservations: number;
  sent: number;
  pending: number;
  failed: number;
  notYetQueued: number;
  // Not yet queued plus FAILED rows of the current revision, which a new send revives.
  sendable: number;
  firstTimeSendable: number;
  updateSendable: number;
  hasOlderSent: boolean;
  lastSentAt: Date | null;
}

export type QueueEventLocationEmailsResult =
  | { ok: true; queued: number; locationRevision: number }
  | {
      ok: false;
      error: "EVENT_NOT_FOUND" | "LOCATION_NOT_CONFIRMED" | "LOCATION_CHANGED" | "TRY_AGAIN";
    };

export interface EventLocationEmailRepository {
  queue(
    eventId: string,
    loadedLocation: LoadedLocationVersion,
    actorAdminId: string,
  ): Promise<QueueEventLocationEmailsResult>;
  getSummary(eventId: string): Promise<EventLocationEmailSummary | null>;
}
