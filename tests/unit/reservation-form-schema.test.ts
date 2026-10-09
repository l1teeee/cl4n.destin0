import { describe, expect, it } from "vitest";

import { reservationRequestSchema } from "@/contracts/reservation-request";
import { reservationFormSchema } from "@/ui/public/reservation-form-schema";

const validFields = {
  fullName: "Ana López",
  instagram: "ana.lopez",
  phone: "7123 4567",
  email: "ana@example.com",
  partySize: 2,
  hasAllergies: false,
  notes: "Sin alergias",
  acceptTerms: true,
} as const;

describe("reservationFormSchema", () => {
  it("omits server-composed fields", () => {
    const schema = reservationFormSchema(2);
    expect(schema.keyof().options).not.toContain("eventSlug");
    expect(schema.keyof().options).not.toContain("turnstileToken");
  });

  it("reuses the shared contract field schemas", () => {
    const schema = reservationFormSchema(2);
    for (const field of schema.keyof().options) {
      expect(schema.shape[field]).toBe(reservationRequestSchema.shape[field]);
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
    ["allergies without detail", { ...validFields, hasAllergies: true }],
    ["allergies with detail", { ...validFields, hasAllergies: true, allergies: "Maní" }],
    ["terms rejected", { ...validFields, acceptTerms: false }],
  ])("keeps the contract result for %s", (_label, fields) => {
    const formResult = reservationFormSchema(20).safeParse(fields).success;
    const requestResult = reservationRequestSchema.safeParse({
      ...fields,
      eventSlug: "cena-clandestino",
      turnstileToken: "token",
    }).success;
    expect(formResult).toBe(requestResult);
  });

  it.each([
    ["abc", false],
    ["12", false],
    ["7012 3456", true],
    ["+503 7012 3456", true],
  ])("validates phone %j with the domain normalizer", (phone, accepted) => {
    const result = reservationFormSchema(2).safeParse({ ...validFields, phone });

    expect(result.success).toBe(accepted);
    if (!accepted) {
      expect(result.error?.flatten().fieldErrors.phone).toEqual(["Ingresa un teléfono válido."]);
    }
  });

  it("rejects a party above the event maximum", () => {
    const result = reservationFormSchema(1).safeParse(validFields);

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.partySize).toEqual([
      "La cantidad de personas supera el máximo permitido.",
    ]);
  });
});
