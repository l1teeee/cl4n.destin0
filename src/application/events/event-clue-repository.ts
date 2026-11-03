import type { RecipientGroup } from "@/application/messaging/recipient-groups";

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

// How far one clue got among the people in CONFIRMED reservations with stage PAID right now.
export interface EventClueDelivery {
  paid: number;
  received: number;
  pending: number;
  failed: number;
}

export type AddEventClueResult =
  { ok: true; value: EventClue } | { ok: false; error: "EVENT_NOT_FOUND" };

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
  sendToPerson(input: {
    eventId: string;
    clueId: string;
    reservationId: string;
    slot: 1 | 2;
    actorId: string;
  }): Promise<SendClueResult>;
  listRecipients(eventId: string): Promise<RecipientGroup[]>;
  listForEvent(eventId: string): Promise<EventClue[]>;
  getDeliveryForEvent(eventId: string): Promise<Record<string, EventClueDelivery>>;
  getImageForSlug(slug: string, imageId: string): Promise<StoredEventClueImage | null>;
}
