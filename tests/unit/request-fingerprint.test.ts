import { describe, expect, it } from "vitest";

import {
  requestFingerprint,
  type NormalizedReservationFingerprintInput,
} from "@/infrastructure/crypto/request-fingerprint";

const normalizedRequest: NormalizedReservationFingerprintInput = {
  eventSlug: "cena-clandestino",
  fullName: "Ana López",
  instagram: "ana.lopez",
  phone: "+50371234567",
  email: "ana@example.com",
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
      email: normalizedRequest.email,
      phone: normalizedRequest.phone,
      instagram: normalizedRequest.instagram,
      fullName: normalizedRequest.fullName,
      eventSlug: normalizedRequest.eventSlug,
    };

    expect(requestFingerprint(reordered)).toBe(requestFingerprint(normalizedRequest));
  });

  it.each([
    ["eventSlug", "otra-cena"],
    ["fullName", "Luis Pérez"],
    ["instagram", "luis.perez"],
    ["phone", "+50322223333"],
    ["email", "luis@example.com"],
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
