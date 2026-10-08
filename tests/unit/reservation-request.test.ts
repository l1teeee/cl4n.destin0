import { describe, expect, it } from "vitest";

import { reservationRequestSchema } from "@/contracts/reservation-request";

const validRequest = {
  eventSlug: "cena-clandestino",
  fullName: "Ana López",
  instagram: "@ana.lopez",
  phone: "7123 4567",
  email: "ana@example.com",
  partySize: 2,
  hasAllergies: false,
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

  it("requires an allergy description when the guest answers yes", () => {
    const result = reservationRequestSchema.safeParse({
      ...validRequest,
      hasAllergies: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["allergies"],
          message: "Cuéntanos a qué eres alérgico.",
        }),
      );
    }
  });

  it("accepts and trims an allergy description when the guest answers yes", () => {
    const result = reservationRequestSchema.parse({
      ...validRequest,
      hasAllergies: true,
      allergies: "  Maní y mariscos  ",
    });

    expect(result.allergies).toBe("Maní y mariscos");
  });

  it("requires an allergy answer", () => {
    const result = reservationRequestSchema.safeParse({
      ...validRequest,
      hasAllergies: undefined,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["hasAllergies"],
          message: "Indica si tienes alergias.",
        }),
      );
    }
  });

  it("accepts an allergy description when the guest answers no", () => {
    expect(
      reservationRequestSchema.safeParse({
        ...validRequest,
        hasAllergies: false,
        allergies: "Este valor se ignorará",
      }).success,
    ).toBe(true);
  });

  it("rejects allergy descriptions longer than 300 characters", () => {
    const result = reservationRequestSchema.safeParse({
      ...validRequest,
      hasAllergies: true,
      allergies: "a".repeat(301),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["allergies"],
          message: "La descripción de alergias no puede superar 300 caracteres.",
        }),
      );
    }
  });

  it("rejects control characters in allergy descriptions", () => {
    const result = reservationRequestSchema.safeParse({
      ...validRequest,
      hasAllergies: true,
      allergies: "Maní\0",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["allergies"],
          message: "No se permiten caracteres de control.",
        }),
      );
    }
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

  it.each(["eventSlug", "fullName", "instagram", "phone", "email", "notes", "turnstileToken"])(
    "rejects NUL in %s with the control-character message",
    (field) => {
      const result = reservationRequestSchema.safeParse({
        ...validRequest,
        [field]: `${validRequest[field as keyof typeof validRequest]}\0`,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: [field],
            message: "No se permiten caracteres de control.",
          }),
        );
      }
    },
  );

  it.each(["\n", "\t", "\r", "\u001f", "\u007f"])(
    "rejects ASCII control character %j in ordinary text fields",
    (character) => {
      const result = reservationRequestSchema.safeParse({
        ...validRequest,
        fullName: `Ana${character}Lopez`,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ["fullName"],
            message: "No se permiten caracteres de control.",
          }),
        );
      }
    },
  );

  it.each(["\nAna", "Ana\n", "\tAna", "Ana\t"])(
    "rejects control characters even when trimming could remove them from %j",
    (fullName) => {
      const result = reservationRequestSchema.safeParse({ ...validRequest, fullName });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ["fullName"],
            message: "No se permiten caracteres de control.",
          }),
        );
      }
    },
  );

  it("allows newline and tab in notes", () => {
    const result = reservationRequestSchema.safeParse({
      ...validRequest,
      notes: "Primera linea\n\tSegunda linea",
    });

    expect(result.success).toBe(true);
  });
});
