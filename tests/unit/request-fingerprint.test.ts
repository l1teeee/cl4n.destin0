import { describe, expect, it } from "vitest";

import {
  requestFingerprint,
  type NormalizedGuestRequestFingerprintInput,
} from "@/infrastructure/crypto/request-fingerprint";

const normalizedRequest: NormalizedGuestRequestFingerprintInput = {
  eventSlug: "cena-clandestino",
  guests: [
    { name: "Ana López", instagram: "ana.lopez" },
    { name: "Luis Pérez", instagram: "luis.perez" },
  ],
  hasAllergies: false,
  allergies: null,
  notes: "Sin alergias",
  acceptTerms: true,
  turnstileToken: "token-one",
};

describe("requestFingerprint", () => {
  it("is stable regardless of input key insertion order", () => {
    const reordered = {
      turnstileToken: normalizedRequest.turnstileToken,
      acceptTerms: normalizedRequest.acceptTerms,
      notes: normalizedRequest.notes,
      allergies: normalizedRequest.allergies,
      hasAllergies: normalizedRequest.hasAllergies,
      guests: normalizedRequest.guests.map(({ name, instagram }) => ({ instagram, name })),
      eventSlug: normalizedRequest.eventSlug,
    };

    expect(requestFingerprint(reordered)).toBe(requestFingerprint(normalizedRequest));
  });

  it.each([
    ["eventSlug", "otra-cena"],

    ["notes", "Vegetariano"],
    ["hasAllergies", true],
    ["allergies", "Maní"],
  ] as const)("changes when %s changes", (field, value) => {
    const changed = { ...normalizedRequest, [field]: value };
    expect(requestFingerprint(changed)).not.toBe(requestFingerprint(normalizedRequest));
  });

  it.each([0, 1])("changes when guest %i changes", (index) => {
    for (const field of ["name", "instagram"] as const) {
      const guests = normalizedRequest.guests.map((guest, i) =>
        i === index ? { ...guest, [field]: "changed" } : guest,
      );
      expect(requestFingerprint({ ...normalizedRequest, guests })).not.toBe(
        requestFingerprint(normalizedRequest),
      );
    }
  });

  it("changes with group size and guest order", () => {
    expect(
      requestFingerprint({ ...normalizedRequest, guests: normalizedRequest.guests.slice(0, 1) }),
    ).not.toBe(requestFingerprint(normalizedRequest));
    expect(
      requestFingerprint({ ...normalizedRequest, guests: [...normalizedRequest.guests].reverse() }),
    ).not.toBe(requestFingerprint(normalizedRequest));
  });

  it("ignores the Turnstile token", () => {
    expect(requestFingerprint({ ...normalizedRequest, turnstileToken: "token-two" })).toBe(
      requestFingerprint(normalizedRequest),
    );
  });
});
