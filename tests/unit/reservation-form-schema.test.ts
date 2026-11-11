import { describe, expect, it } from "vitest";

import { guestRequestSchema } from "@/contracts/guest-request";
import { publicMessages } from "@/ui/public/i18n/messages";
import { reservationFormSchema } from "@/ui/public/reservation-form-schema";

const singleGuest = {
  partySize: 1,
  guest1Name: "Ana López",
  guest1Instagram: "ana.lopez",
  hasAllergies: false,
  notes: "Cerca de la entrada",
  acceptTerms: true,
} as const;

const couple = {
  ...singleGuest,
  partySize: 2,
  guest2Name: "Luis Pérez",
  guest2Instagram: "luis.perez",
} as const;

function fieldErrorsOf(maxPartySize: number, input: Record<string, unknown>) {
  const result = reservationFormSchema(maxPartySize).safeParse(input);
  expect(result.success).toBe(false);
  return result.error?.flatten().fieldErrors ?? {};
}

describe("reservationFormSchema", () => {
  it("accepts the form without server-composed fields and rejects them as input", () => {
    const schema = reservationFormSchema(2);
    expect(schema.parse(singleGuest)).toEqual(singleGuest);
    expect(schema.safeParse({ ...singleGuest, eventSlug: "cena" }).success).toBe(false);
    expect(schema.safeParse({ ...singleGuest, turnstileToken: "token" }).success).toBe(false);
  });

  it("does not ask for email or phone", () => {
    const schema = reservationFormSchema(2);
    expect(schema.safeParse({ ...singleGuest, email: "ana@example.com" }).success).toBe(false);
    expect(schema.safeParse({ ...singleGuest, phone: "12345678" }).success).toBe(false);
  });

  it("translates contract validation messages into English", () => {
    const result = reservationFormSchema(2, publicMessages.en.reservation).safeParse({
      ...singleGuest,
      guest1Name: "",
      guest1Instagram: "invalid user!",
      hasAllergies: true,
      acceptTerms: false,
    });
    expect(result.error?.flatten().fieldErrors).toMatchObject({
      guest1Name: ["Full name is required."],
      guest1Instagram: ["Enter a valid Instagram username."],
      acceptTerms: ["You must accept the terms and privacy policy."],
    });
  });

  it("translates cross-field and maximum party size errors", () => {
    const schema = reservationFormSchema(1, publicMessages.en.reservation);
    const result = schema.safeParse({
      ...couple,
      guest2Instagram: "ana.lopez",
      hasAllergies: true,
    });
    expect(result.error?.flatten().fieldErrors).toMatchObject({
      guest2Instagram: ["Each guest needs their own Instagram username."],
      allergies: ["Tell us who is allergic, and to what."],
      partySize: ["The number of people exceeds the allowed maximum."],
    });
  });

  it.each([
    ["one person", singleGuest],
    ["couple", couple],

    ["blank first name", { ...singleGuest, guest1Name: " " }],
    ["long first name", { ...singleGuest, guest1Name: "a".repeat(121) }],
    ["blank first Instagram user", { ...singleGuest, guest1Instagram: " " }],
    ["couple without second guest", { ...singleGuest, partySize: 2 }],
    ["couple with blank second name", { ...couple, guest2Name: " " }],

    ["same Instagram user twice", { ...couple, guest2Instagram: "@Ana.Lopez" }],
    ["long notes", { ...singleGuest, notes: "a".repeat(501) }],
    ["allergies without detail", { ...singleGuest, hasAllergies: true }],
    ["allergies with detail", { ...singleGuest, hasAllergies: true, allergies: "Maní" }],
    ["couple allergies without detail", { ...couple, hasAllergies: true }],
    ["missing allergy answer", { ...singleGuest, hasAllergies: undefined }],
    ["terms rejected", { ...singleGuest, acceptTerms: false }],
  ])("keeps the contract result for %s", (_label, fields) => {
    const formResult = reservationFormSchema(2).safeParse(fields).success;
    const { partySize, guest1Name, guest1Instagram, guest2Name, guest2Instagram, ...common } =
      fields as Record<string, unknown>;
    const requestResult = guestRequestSchema.safeParse({
      ...common,
      guests: [
        { name: guest1Name, instagram: guest1Instagram },
        ...(partySize === 2 ? [{ name: guest2Name, instagram: guest2Instagram }] : []),
      ],
      eventSlug: "cena-clandestino",
      turnstileToken: "token",
    }).success;
    expect(formResult).toBe(requestResult);
  });

  it.each([undefined, 0, 3, 1.5, "2"])("rejects unsupported form count %j", (partySize) => {
    expect(reservationFormSchema(2).safeParse({ ...singleGuest, partySize }).success).toBe(false);
  });

  it("accepts one person and a couple", () => {
    expect(reservationFormSchema(2).safeParse(singleGuest).success).toBe(true);
    expect(reservationFormSchema(2).safeParse(couple).success).toBe(true);
  });

  it("requires choosing between one person and a couple", () => {
    expect(fieldErrorsOf(2, { ...singleGuest, partySize: undefined }).partySize).toEqual([
      "Elige si vienes solo o en pareja.",
    ]);
  });

  it("requires both second guest fields for a couple", () => {
    expect(fieldErrorsOf(2, { ...singleGuest, partySize: 2 })).toMatchObject({
      guest2Name: ["El nombre del invitado 2 es obligatorio."],
      guest2Instagram: ["El usuario de Instagram del invitado 2 es obligatorio."],
    });
  });

  it("rejects second guest fields for one person", () => {
    expect(
      fieldErrorsOf(2, { ...singleGuest, guest2Name: "Luis Pérez", guest2Instagram: "luis.perez" }),
    ).toMatchObject({
      guest2Name: ["Quita los datos del invitado 2 o elige pareja."],
      guest2Instagram: ["Quita los datos del invitado 2 o elige pareja."],
    });
  });

  it("rejects the same Instagram user twice, ignoring case and the leading @", () => {
    expect(
      fieldErrorsOf(2, {
        ...couple,
        guest1Instagram: " Ana.Lopez ",
        guest2Instagram: "@ana.lopez",
      }),
    ).toMatchObject({
      guest2Instagram: ["Cada invitado necesita su propio usuario de Instagram."],
    });
  });

  it("asks for the allergy description with a message that depends on the party", () => {
    expect(fieldErrorsOf(2, { ...singleGuest, hasAllergies: true }).allergies).toEqual([
      "Cuéntanos a qué eres alérgico.",
    ]);
    expect(fieldErrorsOf(2, { ...couple, hasAllergies: true }).allergies).toEqual([
      "Cuéntanos quién y a qué es alérgico.",
    ]);
  });

  it("rejects a couple when the event allows one person", () => {
    expect(fieldErrorsOf(1, couple).partySize).toEqual([
      "La cantidad de personas supera el máximo permitido.",
    ]);
  });

  it("accepts one person when the event allows one person", () => {
    expect(reservationFormSchema(1).safeParse(singleGuest).success).toBe(true);
  });

  it("trims names and Instagram users", () => {
    const result = reservationFormSchema(2).parse({
      ...couple,
      guest1Name: "  Ana López  ",
      guest2Instagram: "  luis.perez ",
    });
    expect(result.guest1Name).toBe("Ana López");
    expect(result.guest2Instagram).toBe("luis.perez");
  });

  it("validates group additional guests and flags duplicate Instagram handles on the duplicated block", () => {
    const schema = reservationFormSchema(4);
    expect(
      schema.safeParse({
        ...singleGuest,
        partySize: 3,
        additionalGuests: [
          { name: "Luis Pérez", instagram: "luis.perez" },
          { name: "Carla Gómez", instagram: "carla.gomez" },
        ],
      }).success,
    ).toBe(true);

    const duplicateResult = schema.safeParse({
      ...singleGuest,
      partySize: 3,
      additionalGuests: [
        { name: "Luis Pérez", instagram: "luis.perez" },
        { name: "Carla Gómez", instagram: "@Ana.Lopez" },
      ],
    });
    expect(duplicateResult.success).toBe(false);
    expect(duplicateResult.error?.issues).toEqual([
      expect.objectContaining({
        path: ["additionalGuests", 1, "instagram"],
        message: "Cada invitado necesita su propio usuario de Instagram.",
      }),
    ]);
  });
});
