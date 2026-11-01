import { splitIntoChunks } from "./text-chunks";

// messages.body is capped by the messages_body_length_chk database constraint.
export const MAX_MESSAGE_BODY_LENGTH = 2000;

// Text chunks plus photos are sent as separate parts of one message; delivery stops being reliable beyond this.
export const MAX_MESSAGE_PARTS = 20;

export const MAX_LOCATION_PHOTOS = 6;

export interface LocationMessageContent {
  name: string | null;
  address: string | null;
  notes: string | null;
  mapsUrl: string | null;
}

export function composeLocationText(location: LocationMessageContent): string {
  return [location.name, location.address, location.notes, location.mapsUrl]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join("\n");
}

// Array.from counts code points like PostgreSQL char_length, so an emoji is not counted twice.
export function fitsInMessageBody(body: string, photoCount = 0): boolean {
  if (Array.from(body).length > MAX_MESSAGE_BODY_LENGTH) {
    return false;
  }
  return splitIntoChunks(body).length + photoCount <= MAX_MESSAGE_PARTS;
}
