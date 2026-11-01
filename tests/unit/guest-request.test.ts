import { describe, expect, it } from "vitest";

import { guestRequestSchema } from "@/contracts/guest-request";

const validRequest = {
  eventSlug: "cena-clandestino",
  partySize: 1,
  guest1Name: "Ana López",
  guest1Instagram: "@ana.lopez",
  hasAllergies: false,
  acceptTerms: true,
  turnstileToken: "token",
} as const;

function expectIssue(input: Record<string, unknown>, path: string, message: string): void {
  const result = guestRequestSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues).toContainEqual(expect.objectContaining({ path: [path], message }));
  }
}

describe("guestRequestSchema", () => {
  it.each(["con espacio", "@@@", "a".repeat(31)])("rejects invalid Instagram %s", (value) => {
    expectIssue(
      { ...validRequest, guest1Instagram: value },
      "guest1Instagram",
      "Ingresa un usuario de Instagram válido.",
    );
    expectIssue(
      { ...validRequest, partySize: 2, guest2Name: "Luis Pérez", guest2Instagram: value },
      "guest2Instagram",
      "Ingresa un usuario de Instagram válido.",
    );
  });

  it.each(["@ana.lopez", "https://instagram.com/ana.lopez"])("accepts Instagram %s", (value) => {
    expect(guestRequestSchema.safeParse({ ...validRequest, guest1Instagram: value }).success).toBe(
      true,
    );
  });

  it("accepts and trims a single guest request", () => {
    const result = guestRequestSchema.parse({
      ...validRequest,
      guest1Name: "  Ana López  ",
      notes: "  Cerca de la entrada  ",
    });
    expect(result.guest1Name).toBe("Ana López");
    expect(result.notes).toBe("Cerca de la entrada");
  });

  it("rejects unknown client-controlled fields", () => {
    expect(guestRequestSchema.safeParse({ ...validRequest, eventId: "client" }).success).toBe(
      false,
    );
  });

  it.each([0, 3, 1.5, "2"])("rejects party size %j with the configured message", (partySize) => {
    expectIssue({ ...validRequest, partySize }, "partySize", "Elige si vienes solo o en pareja.");
  });

  it("requires both second guest fields for a couple", () => {
    expectIssue(
      { ...validRequest, partySize: 2 },
      "guest2Name",
      "El nombre del invitado 2 es obligatorio.",
    );
    expectIssue(
      { ...validRequest, partySize: 2, guest2Name: "Luis Pérez" },
      "guest2Instagram",
      "El usuario de Instagram del invitado 2 es obligatorio.",
    );
  });

  it("rejects second guest fields for a single guest", () => {
    expectIssue(
      { ...validRequest, guest2Name: "Luis Pérez" },
      "guest2Name",
      "Quita los datos del invitado 2 o elige pareja.",
    );
    expectIssue(
      { ...validRequest, guest2Instagram: "luis.perez" },
      "guest2Instagram",
      "Quita los datos del invitado 2 o elige pareja.",
    );
  });

  it("requires the allergy description with party-specific messages", () => {
    expectIssue(
      { ...validRequest, hasAllergies: true },
      "allergies",
      "Cuéntanos a qué eres alérgico.",
    );
    expectIssue(
      {
        ...validRequest,
        partySize: 2,
        guest2Name: "Luis Pérez",
        guest2Instagram: "luis.perez",
        hasAllergies: true,
      },
      "allergies",
      "Cuéntanos quién y a qué es alérgico.",
    );
  });

  it("requires the allergy boolean", () => {
    expectIssue(
      { ...validRequest, hasAllergies: undefined },
      "hasAllergies",
      "Indica si hay alergias.",
    );
  });

  it("rejects the same normalized Instagram handle for both guests", () => {
    expectIssue(
      {
        ...validRequest,
        partySize: 2,
        guest1Instagram: " @Ana.Name ",
        guest2Name: "Luis Pérez",
        guest2Instagram: "ana.name",
      },
      "guest2Instagram",
      "Cada invitado necesita su propio usuario de Instagram.",
    );
  });

  it("accepts a valid couple with distinct handles", () => {
    expect(
      guestRequestSchema.safeParse({
        ...validRequest,
        partySize: 2,
        guest2Name: "Luis Pérez",
        guest2Instagram: "luis.perez",
      }).success,
    ).toBe(true);
  });

  it("requires terms acceptance", () => {
    expectIssue(
      { ...validRequest, acceptTerms: false },
      "acceptTerms",
      "Debes aceptar los términos y la política de privacidad.",
    );
  });

  it.each([
    ["eventSlug", " ", "El evento es obligatorio."],
    ["eventSlug", "Evento Malo", "El identificador del evento no tiene un formato válido."],
    ["guest1Name", " ", "El nombre completo es obligatorio."],
    ["guest1Name", "a".repeat(121), "El nombre completo no puede superar 120 caracteres."],
    ["allergies", "a".repeat(301), "La descripción de alergias no puede superar 300 caracteres."],
    ["notes", "a".repeat(501), "Las observaciones no pueden superar 500 caracteres."],
    ["turnstileToken", "a".repeat(2049), "La verificación de seguridad no es válida."],
  ] as const)("validates %s boundaries", (field, value, message) => {
    expectIssue({ ...validRequest, [field]: value }, field, message);
  });

  it.each(["eventSlug", "guest1Name", "guest1Instagram", "turnstileToken"])(
    "rejects control characters in %s",
    (field) => {
      expectIssue(
        {
          ...validRequest,
          [field]: `${String(validRequest[field as keyof typeof validRequest])}\0`,
        },
        field,
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
      "notes",
      "No se permiten caracteres de control.",
    );
    expectIssue(
      { ...validRequest, allergies: "Maní\0" },
      "allergies",
      "No se permiten caracteres de control.",
    );
  });
});
