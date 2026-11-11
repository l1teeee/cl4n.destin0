import { describe, expect, it } from "vitest";

import { guestRequestSchema, partySizeOf } from "@/contracts/guest-request";
import { MAX_PARTY_SIZE } from "@/domain/reservation/request-guests";

const validRequest = {
  eventSlug: "cena-clandestino",
  guests: [{ name: "Ana López", instagram: "@ana.lopez" }],
  hasAllergies: false,
  acceptTerms: true,
  turnstileToken: "token",
} as const;

function expectIssue(input: unknown, path: (string | number)[], message: string): void {
  const result = guestRequestSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues).toContainEqual(expect.objectContaining({ path, message }));
  }
}

describe("guestRequestSchema", () => {
  it.each(["con espacio", "@@@", "a".repeat(31)])("rejects invalid Instagram %s", (value) => {
    for (const index of [0, 1, 3]) {
      const guests = Array.from({ length: 4 }, (_, slot) => ({
        name: `Invitado ${slot}`,
        instagram: slot === index ? value : `guest.${slot}`,
      }));
      expectIssue(
        { ...validRequest, guests },
        ["guests", index, "instagram"],
        "Ingresa un usuario de Instagram válido.",
      );
    }
  });

  it.each(["@ana.lopez", "https://instagram.com/ana.lopez"])("accepts Instagram %s", (value) => {
    expect(
      guestRequestSchema.safeParse({
        ...validRequest,
        guests: [{ name: "Ana López", instagram: value }],
      }).success,
    ).toBe(true);
  });

  it("accepts and trims a single guest request", () => {
    const result = guestRequestSchema.parse({
      ...validRequest,
      guests: [{ name: "  Ana López  ", instagram: "@ana.lopez" }],
      notes: "  Cerca de la entrada  ",
    });
    expect(result.guests[0]!.name).toBe("Ana López");
    expect(result.notes).toBe("Cerca de la entrada");
    expect(partySizeOf(result)).toBe(1);
  });

  it.each([
    "eventId",
    "partySize",
    "guest1Name",
    "guest1Instagram",
    "guest2Name",
    "guest2Instagram",
  ])("rejects unknown or legacy client-controlled field %s", (field) => {
    expect(guestRequestSchema.safeParse({ ...validRequest, [field]: "client" }).success).toBe(
      false,
    );
  });

  it.each([1, 2, 4, MAX_PARTY_SIZE])("accepts %i distinct guests", (size) => {
    const guests = Array.from({ length: size }, (_, index) => ({
      name: `Guest ${index}`,
      instagram: `guest.${index}`,
    }));
    const result = guestRequestSchema.parse({ ...validRequest, guests });
    expect(result.guests).toEqual(guests);
    expect(partySizeOf(result)).toBe(size);
  });

  it.each([
    [],
    Array.from({ length: MAX_PARTY_SIZE + 1 }, (_, index) => ({
      name: `Guest ${index}`,
      instagram: `guest.${index}`,
    })),
    "2",
    undefined,
  ])("rejects invalid guest lists %#", (guests) => {
    const result = guestRequestSchema.safeParse({ ...validRequest, guests });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "guests")).toBe(true);
    }
  });

  it("requires a name and Instagram for every companion", () => {
    expectIssue(
      { ...validRequest, guests: [...validRequest.guests, { instagram: "luis" }] },
      ["guests", 1, "name"],
      "El nombre completo es obligatorio.",
    );
    expectIssue(
      { ...validRequest, guests: [...validRequest.guests, { name: "Luis" }] },
      ["guests", 1, "instagram"],
      "El usuario de Instagram es obligatorio.",
    );
  });

  it("requires the allergy description with group-specific messages", () => {
    expectIssue(
      { ...validRequest, hasAllergies: true },
      ["allergies"],
      "Cuéntanos a qué eres alérgico.",
    );
    for (const size of [2, 4]) {
      expectIssue(
        {
          ...validRequest,
          hasAllergies: true,
          guests: Array.from({ length: size }, (_, index) => ({
            name: `Guest ${index}`,
            instagram: `guest.${index}`,
          })),
        },
        ["allergies"],
        "Cuéntanos quién y a qué es alérgico.",
      );
    }
  });

  it("requires the allergy boolean", () => {
    expectIssue(
      { ...validRequest, hasAllergies: undefined },
      ["hasAllergies"],
      "Indica si hay alergias.",
    );
  });

  it("rejects the same normalized Instagram handle anywhere in a group", () => {
    expectIssue(
      {
        ...validRequest,
        guests: [
          { name: "Ana", instagram: " @Ana.Name " },
          { name: "Luis", instagram: "luis" },
          { name: "Marta", instagram: "https://instagram.com/ana.name/" },
        ],
      },
      ["guests", 2, "instagram"],
      "Cada invitado necesita su propio usuario de Instagram.",
    );
  });

  it("requires terms acceptance", () => {
    expectIssue(
      { ...validRequest, acceptTerms: false },
      ["acceptTerms"],
      "Debes aceptar los términos y la política de privacidad.",
    );
  });

  it.each([
    ["eventSlug", " ", "El evento es obligatorio."],
    ["eventSlug", "Evento Malo", "El identificador del evento no tiene un formato válido."],
    ["allergies", "a".repeat(301), "La descripción de alergias no puede superar 300 caracteres."],
    ["notes", "a".repeat(501), "Las observaciones no pueden superar 500 caracteres."],
    ["turnstileToken", "a".repeat(2049), "La verificación de seguridad no es válida."],
  ])("validates %s boundaries", (field, value, message) => {
    expectIssue({ ...validRequest, [field]: value }, [field], message);
  });

  it.each([
    [" ", "El nombre completo es obligatorio."],
    ["a".repeat(121), "El nombre completo no puede superar 120 caracteres."],
  ])("validates each name boundary %#", (name, message) => {
    expectIssue(
      {
        ...validRequest,
        guests: [{ name, instagram: "ana" }],
      },
      ["guests", 0, "name"],
      message,
    );
  });

  it.each(["eventSlug", "turnstileToken"] as const)("rejects control characters in %s", (field) => {
    expectIssue(
      {
        ...validRequest,
        [field]: `${validRequest[field]}\0`,
      },
      [field],
      "No se permiten caracteres de control.",
    );
  });

  it.each(["name", "instagram"] as const)(
    "rejects control characters in each guest %s",
    (field) => {
      expectIssue(
        {
          ...validRequest,
          guests: [{ name: "Ana", instagram: "ana", [field]: "ana\0" }],
        },
        ["guests", 0, field],
        "No se permiten caracteres de control.",
      );
    },
  );

  it("allows newline and tab in note fields but rejects NUL", () => {
    expect(
      guestRequestSchema.safeParse({
        ...validRequest,
        notes: "Primera línea\n\tSegunda línea",
      }).success,
    ).toBe(true);
    expectIssue(
      { ...validRequest, notes: "Texto\0" },
      ["notes"],
      "No se permiten caracteres de control.",
    );
    expectIssue(
      { ...validRequest, allergies: "Maní\0" },
      ["allergies"],
      "No se permiten caracteres de control.",
    );
  });
});
