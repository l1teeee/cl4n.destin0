import { describe, expect, it } from "vitest";

import { guestRequestBaseSchema, guestRequestSchema } from "@/contracts/guest-request";
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
  it("omits server-composed fields", () => {
    const schema = reservationFormSchema(2);
    expect(schema.keyof().options).not.toContain("eventSlug");
    expect(schema.keyof().options).not.toContain("turnstileToken");
  });

  it("does not ask for email or phone", () => {
    const fields = reservationFormSchema(2).keyof().options;
    expect(fields).not.toContain("email");
    expect(fields).not.toContain("phone");
  });

  it("reuses the shared contract field schemas except the party choice", () => {
    const schema = reservationFormSchema(2);
    const reusedFields = schema.keyof().options.filter((field) => field !== "partySize");

    expect(reusedFields).toContain("guest1Name");
    for (const field of reusedFields) {
      expect(schema.shape[field]).toBe(guestRequestBaseSchema.shape[field]);
    }
  });

  it.each([
    ["one person", singleGuest],
    ["couple", couple],
    ["no party chosen", { ...singleGuest, partySize: undefined }],
    ["party of zero", { ...singleGuest, partySize: 0 }],
    ["party of three", { ...couple, partySize: 3 }],
    ["fractional party", { ...singleGuest, partySize: 1.5 }],
    ["party sent as text", { ...couple, partySize: "2" }],
    ["blank first name", { ...singleGuest, guest1Name: " " }],
    ["long first name", { ...singleGuest, guest1Name: "a".repeat(121) }],
    ["blank first Instagram user", { ...singleGuest, guest1Instagram: " " }],
    ["couple without second guest", { ...singleGuest, partySize: 2 }],
    ["couple with blank second name", { ...couple, guest2Name: " " }],
    [
      "one person with second guest",
      { ...singleGuest, guest2Name: "Luis Pérez", guest2Instagram: "luis.perez" },
    ],
    ["same Instagram user twice", { ...couple, guest2Instagram: "@Ana.Lopez" }],
    ["long notes", { ...singleGuest, notes: "a".repeat(501) }],
    ["allergies without detail", { ...singleGuest, hasAllergies: true }],
    ["allergies with detail", { ...singleGuest, hasAllergies: true, allergies: "Maní" }],
    ["couple allergies without detail", { ...couple, hasAllergies: true }],
    ["missing allergy answer", { ...singleGuest, hasAllergies: undefined }],
    ["terms rejected", { ...singleGuest, acceptTerms: false }],
  ])("keeps the contract result for %s", (_label, fields) => {
    const formResult = reservationFormSchema(2).safeParse(fields).success;
    const requestResult = guestRequestSchema.safeParse({
      ...fields,
      eventSlug: "cena-clandestino",
      turnstileToken: "token",
    }).success;
    expect(formResult).toBe(requestResult);
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
});
