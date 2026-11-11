import { createHash } from "node:crypto";

export interface NormalizedGuestRequestFingerprintInput {
  eventSlug: string;
  guests: { name: string; instagram: string }[];
  notes?: string;
  hasAllergies: boolean;
  allergies: string | null;
  acceptTerms: true;
  turnstileToken?: string;
}

function canonicalJson(value: Record<string, unknown>): string {
  const sortedEntries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

export function requestFingerprint(input: NormalizedGuestRequestFingerprintInput): string {
  const payload = {
    acceptTerms: input.acceptTerms,
    allergies: input.allergies,
    eventSlug: input.eventSlug,
    guests: input.guests.map(({ name, instagram }) => ({ name, instagram })),
    hasAllergies: input.hasAllergies,
    notes: input.notes ?? null,
  };

  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
