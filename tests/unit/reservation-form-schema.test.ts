import { describe, expect, it } from "vitest";

import { reservationRequestSchema } from "@/contracts/reservation-request";
import { reservationFormSchema } from "@/ui/public/reservation-form-schema";

const validFields = {
  fullName: "Ana López",
  instagram: "ana.lopez",
  phone: "7123 4567",
  email: "ana@example.com",
  partySize: 2,
  notes: "Sin alergias",
  acceptTerms: true,
} as const;

describe("reservationFormSchema", () => {
  it("omits server-composed fields", () => {
    expect(reservationFormSchema.keyof().options).not.toContain("eventSlug");
    expect(reservationFormSchema.keyof().options).not.toContain("turnstileToken");
  });

  it("reuses the shared contract field schemas", () => {
    for (const field of reservationFormSchema.keyof().options) {
      expect(reservationFormSchema.shape[field]).toBe(reservationRequestSchema.shape[field]);
    }
  });

  it.each([
    ["valid", validFields],
    ["blank name", { ...validFields, fullName: " " }],
    ["long name", { ...validFields, fullName: "a".repeat(121) }],
    ["invalid email", { ...validFields, email: "invalid" }],
    ["small party", { ...validFields, partySize: 0 }],
    ["large party", { ...validFields, partySize: 21 }],
    ["fractional party", { ...validFields, partySize: 1.5 }],
    ["long notes", { ...validFields, notes: "a".repeat(501) }],
    ["terms rejected", { ...validFields, acceptTerms: false }],
  ])("keeps the contract result for %s", (_label, fields) => {
    const formResult = reservationFormSchema.safeParse(fields).success;
    const requestResult = reservationRequestSchema.safeParse({
      ...fields,
      eventSlug: "cena-clandestino",
      turnstileToken: "token",
    }).success;
    expect(formResult).toBe(requestResult);
  });
});
