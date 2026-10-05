import { createHash } from "node:crypto";

export interface NormalizedReservationFingerprintInput {
  eventSlug: string;
  fullName: string;
  instagram: string;
  phone: string;
  email: string;
  partySize: number;
  notes?: string;
  acceptTerms: true;
  turnstileToken?: string;
}

function canonicalJson(value: Record<string, unknown>): string {
  const sortedEntries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

export function requestFingerprint(input: NormalizedReservationFingerprintInput): string {
  const payload = {
    acceptTerms: input.acceptTerms,
    email: input.email,
    eventSlug: input.eventSlug,
    fullName: input.fullName,
    instagram: input.instagram,
    notes: input.notes ?? null,
    partySize: input.partySize,
    phone: input.phone,
  };

  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
