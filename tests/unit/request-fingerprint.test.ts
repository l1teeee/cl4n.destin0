import { describe, expect, it } from "vitest";

import {
  requestFingerprint,
  type NormalizedGuestRequestFingerprintInput,
} from "@/infrastructure/crypto/request-fingerprint";

const normalizedRequest: NormalizedGuestRequestFingerprintInput = {
  eventSlug: "cena-clandestino",
  guest1Name: "Ana López",
  guest1Instagram: "ana.lopez",
  guest2Name: "Luis Pérez",
  guest2Instagram: "luis.perez",
  partySize: 2,
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
      partySize: normalizedRequest.partySize,
      guest2Instagram: normalizedRequest.guest2Instagram,
      guest2Name: normalizedRequest.guest2Name,
      guest1Instagram: normalizedRequest.guest1Instagram,
      guest1Name: normalizedRequest.guest1Name,
      eventSlug: normalizedRequest.eventSlug,
    };

    expect(requestFingerprint(reordered)).toBe(requestFingerprint(normalizedRequest));
  });

  it.each([
    ["eventSlug", "otra-cena"],
    ["guest1Name", "María López"],
    ["guest1Instagram", "maria.lopez"],
    ["guest2Name", "Mario Pérez"],
    ["guest2Instagram", "mario.perez"],
    ["partySize", 1],
    ["notes", "Vegetariano"],
    ["hasAllergies", true],
    ["allergies", "Maní"],
  ] as const)("changes when %s changes", (field, value) => {
    const changed = { ...normalizedRequest, [field]: value };
    expect(requestFingerprint(changed)).not.toBe(requestFingerprint(normalizedRequest));
  });

  it("ignores the Turnstile token", () => {
    expect(requestFingerprint({ ...normalizedRequest, turnstileToken: "token-two" })).toBe(
      requestFingerprint(normalizedRequest),
    );
  });
});
