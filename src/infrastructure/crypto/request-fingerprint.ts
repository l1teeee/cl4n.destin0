import { createHash } from "node:crypto";

export interface NormalizedGuestRequestFingerprintInput {
  eventSlug: string;
  guest1Name: string;
  guest1Instagram: string;
  guest2Name: string | null;
  guest2Instagram: string | null;
  partySize: 1 | 2;
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
    guest1Instagram: input.guest1Instagram,
    guest1Name: input.guest1Name,
    guest2Instagram: input.guest2Instagram,
    guest2Name: input.guest2Name,
    hasAllergies: input.hasAllergies,
    notes: input.notes ?? null,
    partySize: input.partySize,
  };

  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
