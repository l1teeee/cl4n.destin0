import type { EventImageContentType } from "@/contracts/event-image";

export interface EventImageItem {
  id: string;
  contentType: EventImageContentType;
  byteSize: number;
  createdAt: Date;
}

export interface StoredEventImage extends EventImageItem {
  data: Uint8Array;
}

export type AddEventImageResult =
  | { ok: true; value: EventImageItem }
  | { ok: false; error: "EVENT_NOT_FOUND" | "MAX_IMAGES_REACHED" };

export interface EventImageRepository {
  add(input: {
    eventId: string;
    contentType: EventImageContentType;
    data: Uint8Array;
    actorId: string;
  }): Promise<AddEventImageResult>;
  list(eventId: string): Promise<EventImageItem[]>;
  get(eventId: string, imageId: string): Promise<StoredEventImage | null>;
  getByPublicToken(publicToken: string): Promise<StoredEventImage | null>;
  remove(eventId: string, imageId: string, actorId: string): Promise<boolean>;
}
