import { z } from "zod";

import type { GuestFields } from "@/application/guests/guest-admin-repository";
import { EVENT_GUEST_VIEWS } from "@/application/guests/guest-views";
import { normalizeInstagram } from "@/domain/reservation/contact-normalization";

const controlCharacters = /[\u0000-\u001f\u007f]/;
const noteControlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const controlCharacterMessage = "No se permiten caracteres de control.";

const name = z
  .string({ error: "El nombre completo es obligatorio." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El nombre completo es obligatorio.")
  .max(120, "El nombre completo no puede superar 120 caracteres.");

const instagram = z
  .string({ error: "El usuario de Instagram es obligatorio." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El usuario de Instagram es obligatorio.")
  .transform((value, context) => {
    const normalized = normalizeInstagram(value);
    if (!normalized.ok) {
      context.addIssue({ code: "custom", message: "Ingresa un usuario de Instagram válido." });
      return z.NEVER;
    }
    return normalized.value;
  });

const optionalText = (max: number, tooLong: string) =>
  z
    .string({ error: "El campo debe ser texto." })
    .refine((value) => !noteControlCharacters.test(value), controlCharacterMessage)
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value));

const rawGuestFieldsSchema = z
  .object({
    partySize: z
      .enum(["1", "2"], { error: "Elige si viene solo o en pareja." })
      .transform((value): 1 | 2 => (value === "2" ? 2 : 1)),
    guest1Name: name,
    guest1Instagram: instagram,
    guest2Name: name.optional(),
    guest2Instagram: instagram.optional(),
    hasAllergies: z
      .enum(["true", "false"], { error: "Indica si hay alergias." })
      .transform((value) => value === "true"),
    allergies: optionalText(
      300,
      "La descripción de alergias no puede superar 300 caracteres.",
    ).optional(),
    notes: optionalText(500, "Las observaciones no pueden superar 500 caracteres."),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.partySize === 2) {
      if (!input.guest2Name) {
        context.addIssue({
          code: "custom",
          path: ["guest2Name"],
          message: "El nombre del invitado 2 es obligatorio.",
        });
      }
      if (!input.guest2Instagram) {
        context.addIssue({
          code: "custom",
          path: ["guest2Instagram"],
          message: "El usuario de Instagram del invitado 2 es obligatorio.",
        });
      }
    } else {
      if (input.guest2Name !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["guest2Name"],
          message: "Quita los datos del invitado 2 o elige pareja.",
        });
      }
      if (input.guest2Instagram !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["guest2Instagram"],
          message: "Quita los datos del invitado 2 o elige pareja.",
        });
      }
    }

    if (input.hasAllergies && !input.allergies) {
      context.addIssue({
        code: "custom",
        path: ["allergies"],
        message:
          input.partySize === 2
            ? "Cuéntanos quién y a qué es alérgico."
            : "Cuéntanos a qué es alérgico.",
      });
    }
    if (!input.hasAllergies && input.allergies) {
      context.addIssue({
        code: "custom",
        path: ["allergies"],
        message: "Quita la descripción de alergias o elige sí.",
      });
    }
    if (input.guest2Instagram && input.guest1Instagram === input.guest2Instagram) {
      context.addIssue({
        code: "custom",
        path: ["guest2Instagram"],
        message: "Cada invitado necesita su propio usuario de Instagram.",
      });
    }
  })
  .transform((input): GuestFields => ({
    partySize: input.partySize,
    guest1Name: input.guest1Name,
    guest1Instagram: input.guest1Instagram,
    guest2Name: input.partySize === 2 ? (input.guest2Name ?? null) : null,
    guest2Instagram: input.partySize === 2 ? (input.guest2Instagram ?? null) : null,
    hasAllergies: input.hasAllergies,
    allergies: input.hasAllergies ? (input.allergies ?? null) : null,
    notes: input.notes,
  }));

export const adminGuestFieldsSchema = rawGuestFieldsSchema;
export const adminGuestIdSchema = z.uuid("El identificador no es válido.");
export const expectedPromotedEntryIdsSchema = z.array(
  z.uuid("La entrada esperada de la cola no es válida."),
);
export const moveEntryDirectionSchema = z.enum(["UP", "DOWN"]);
export const expectedCancellationStageSchema = z.enum(["ON_LIST", "PAID"], {
  error: "La etapa esperada es obligatoria.",
});
export const paymentNoteSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string({ error: "La nota de pago debe ser texto." })
    .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
    .trim()
    .min(1, "La nota de pago no puede estar vacía.")
    .max(200, "La nota de pago no puede superar 200 caracteres.")
    .nullable(),
);
export const eventGuestViewSchema = z.enum(EVENT_GUEST_VIEWS);

export function readAdminGuestFields(formData: FormData) {
  return {
    partySize: formData.get("partySize"),
    guest1Name: formData.get("guest1Name"),
    guest1Instagram: formData.get("guest1Instagram"),
    guest2Name: formData.get("guest2Name") ?? undefined,
    guest2Instagram: formData.get("guest2Instagram") ?? undefined,
    hasAllergies: formData.get("hasAllergies") ?? undefined,
    allergies: formData.get("allergies") ?? undefined,
    notes: formData.get("notes"),
  };
}

export function readSendMessage(formData: FormData): boolean {
  return formData.get("sendMessage") === "on";
}
