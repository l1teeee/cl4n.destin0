export interface EventClue {
  id: string;
  body: string;
  createdAt: Date;
  images: Array<{ id: string }>;
}

export interface StoredEventClueImage {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  data: Uint8Array;
}

// How far one clue got among the reservations that are CONFIRMED with stage PAID right now.
export interface EventClueDelivery {
  paid: number;
  received: number;
  pending: number;
  failed: number;
}

export type AddEventClueResult =
  { ok: true; value: EventClue } | { ok: false; error: "EVENT_NOT_FOUND" };

export type ClueRecipientStatus = "NOT_SENT" | "SENT" | "PENDING" | "FAILED";

export interface ClueRecipient {
  reservationId: string;
  guestName: string;
  instagram: string | null;
  statusByClue: Record<string, ClueRecipientStatus>;
}

export type SendClueResult =
  | { ok: true; messageIds: string[] }
  | { ok: false; error: "CLUE_NOT_FOUND" | "GUEST_NOT_ELIGIBLE" };

export interface EventClueRepository {
  add(input: {
    eventId: string;
    body: string;
    actorId: string;
    images?: StoredEventClueImage[];
  }): Promise<AddEventClueResult>;
  remove(input: { eventId: string; clueId: string; actorId: string }): Promise<boolean>;
  sendToAll(input: { eventId: string; clueId: string; actorId: string }): Promise<SendClueResult>;
  sendToGuest(input: {
    eventId: string;
    clueId: string;
    reservationId: string;
    actorId: string;
  }): Promise<SendClueResult>;
  listRecipients(eventId: string): Promise<ClueRecipient[]>;
  listForEvent(eventId: string): Promise<EventClue[]>;
  getDeliveryForEvent(eventId: string): Promise<Record<string, EventClueDelivery>>;
  getImageForSlug(slug: string, imageId: string): Promise<StoredEventClueImage | null>;
}
