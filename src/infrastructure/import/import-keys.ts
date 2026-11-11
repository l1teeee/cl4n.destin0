import { createHash } from "node:crypto";

import type { ImportPreviewRow } from "@/contracts/guest-import";

export function importRowKey(importId: string, rowNumber: number): string {
  const bytes = createHash("sha256").update(`${importId}:${rowNumber}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function importRowFingerprint(eventId: string, row: ImportPreviewRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        eventId,
        row.guests.map(({ name, instagram }) => ({ name, instagram })),
        row.allergies,
        row.notes,
      ]),
    )
    .digest("hex");
}
