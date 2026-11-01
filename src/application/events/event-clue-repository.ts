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

// messageIds are the CLUE messages queued for PAID guests in the same transaction as the clue.
export type AddEventClueResult =
  { ok: true; value: EventClue; messageIds: string[] } | { ok: false; error: "EVENT_NOT_FOUND" };

export interface EventClueRepository {
  add(input: {
    eventId: string;
    body: string;
    actorId: string;
    images?: StoredEventClueImage[];
  }): Promise<AddEventClueResult>;
  remove(input: { eventId: string; clueId: string; actorId: string }): Promise<boolean>;
  listForEvent(eventId: string): Promise<EventClue[]>;
  getDeliveryForEvent(eventId: string): Promise<Record<string, EventClueDelivery>>;
  listForSlug(slug: string): Promise<EventClue[]>;
  getImageForSlug(slug: string, imageId: string): Promise<StoredEventClueImage | null>;
}
