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

export type AddEventClueResult =
  { ok: true; value: EventClue } | { ok: false; error: "EVENT_NOT_FOUND" };

export interface EventClueRepository {
  add(input: {
    eventId: string;
    body: string;
    actorId: string;
    images?: StoredEventClueImage[];
  }): Promise<AddEventClueResult>;
  remove(input: { eventId: string; clueId: string; actorId: string }): Promise<boolean>;
  listForEvent(eventId: string): Promise<EventClue[]>;
  listForSlug(slug: string): Promise<EventClue[]>;
  getImageForSlug(slug: string, imageId: string): Promise<StoredEventClueImage | null>;
}
