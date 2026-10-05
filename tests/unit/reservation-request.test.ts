import { describe, expect, it } from "vitest";

import { reservationRequestSchema } from "@/contracts/reservation-request";

const validRequest = {
  eventSlug: "cena-clandestino",
  fullName: "Ana López",
  instagram: "@ana.lopez",
  phone: "7123 4567",
  email: "ana@example.com",
  partySize: 2,
  notes: "Sin alergias",
  acceptTerms: true,
  turnstileToken: "token",
} as const;

describe("reservationRequestSchema", () => {
  it("accepts and trims a valid request", () => {
    const result = reservationRequestSchema.parse({
      ...validRequest,
      fullName: "  Ana López  ",
    });

    expect(result.fullName).toBe("Ana López");
  });

  it.each(["capacity", "eventId", "status", "price", "reservedSeats", "submittedAt"])(
    "rejects forbidden client field %s",
    (field) => {
      expect(
        reservationRequestSchema.safeParse({ ...validRequest, [field]: "client-controlled" })
          .success,
      ).toBe(false);
    },
  );

  it("requires terms acceptance to be exactly true", () => {
    expect(
      reservationRequestSchema.safeParse({ ...validRequest, acceptTerms: false }).success,
    ).toBe(false);
  });

  it.each([
    ["fullName", " "],
    ["fullName", "a".repeat(121)],
    ["email", `${"a".repeat(244)}@example.com`],
    ["partySize", 0],
    ["partySize", 21],
    ["partySize", 1.5],
    ["notes", "a".repeat(501)],
    ["turnstileToken", "a".repeat(2049)],
  ] as Array<[string, string | number]>)(
    "rejects %s at its configured boundary",
    (field, value) => {
      expect(reservationRequestSchema.safeParse({ ...validRequest, [field]: value }).success).toBe(
        false,
      );
    },
  );
});
