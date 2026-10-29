import type { ImageContentType } from "@/contracts/image-upload";

export interface EventImageItem {
  id: string;
  contentType: ImageContentType;
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
    contentType: ImageContentType;
    data: Uint8Array;
    actorId: string;
  }): Promise<AddEventImageResult>;
  list(eventId: string): Promise<EventImageItem[]>;
  get(eventId: string, imageId: string): Promise<StoredEventImage | null>;
  getByPublicToken(publicToken: string): Promise<StoredEventImage | null>;
  remove(eventId: string, imageId: string, actorId: string): Promise<boolean>;
}
