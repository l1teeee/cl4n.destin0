export interface EventLocationEmailSummary {
  confirmedReservations: number;
  sent: number;
  pending: number;
  failed: number;
  notYetQueued: number;
  hasOlderSent: boolean;
  lastSentAt: Date | null;
}

export type QueueEventLocationEmailsResult =
  | { ok: true; queued: number; locationRevision: number }
  | { ok: false; error: "EVENT_NOT_FOUND" | "LOCATION_NOT_CONFIRMED" };

export interface EventLocationEmailRepository {
  queue(eventId: string, actorAdminId: string): Promise<QueueEventLocationEmailsResult>;
  getSummary(eventId: string): Promise<EventLocationEmailSummary | null>;
}
