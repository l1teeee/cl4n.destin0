import { z } from "zod";

import type { GuestFields } from "@/application/guests/guest-admin-repository";
import { EVENT_GUEST_VIEWS } from "@/application/guests/guest-views";
import { INVALID_INSTAGRAM_MESSAGE } from "@/contracts/guest-request";
import { normalizeInstagram } from "@/domain/reservation/contact-normalization";
import { MAX_PARTY_SIZE } from "@/domain/reservation/request-guests";

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
      context.addIssue({ code: "custom", message: INVALID_INSTAGRAM_MESSAGE });
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
    guests: z.array(z.object({ name, instagram })).min(1).max(MAX_PARTY_SIZE),
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
    if (input.hasAllergies && !input.allergies) {
      context.addIssue({
        code: "custom",
        path: ["allergies"],
        message:
          input.guests.length > 1
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
    const handles = new Set<string>();
    for (const [index, guest] of input.guests.entries()) {
      if (handles.has(guest.instagram)) {
        context.addIssue({
          code: "custom",
          path: ["guests", index, "instagram"],
          message: "Cada invitado necesita su propio usuario de Instagram.",
        });
      }
      handles.add(guest.instagram);
    }
  })
  .transform((input): GuestFields => ({
    guests: input.guests,
    hasAllergies: input.hasAllergies,
    allergies: input.hasAllergies ? (input.allergies ?? null) : null,
    notes: input.notes,
  }));

export const adminGuestFieldsSchema = rawGuestFieldsSchema;
export const adminGuestIdSchema = z.uuid("El identificador no es válido.");
export const expectedPromotedEntryIdsSchema = z.array(
  z.uuid("La entrada esperada de la cola no es válida."),
);
export const reservationReplacementSchema = z
  .discriminatedUnion("replacementMode", [
    z.object({
      replacementMode: z.literal("auto"),
      expectedPromotedEntryIds: expectedPromotedEntryIdsSchema,
    }),
    z.object({
      replacementMode: z.literal("chosen"),
      replacementEntryId: z.uuid("Elige una entrada válida de la cola."),
    }),
  ])
  .transform((input) =>
    input.replacementMode === "auto"
      ? { mode: input.replacementMode, expectedPromotedEntryIds: input.expectedPromotedEntryIds }
      : { mode: input.replacementMode, waitlistEntryId: input.replacementEntryId },
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
  const names = formData.getAll("guestName");
  const handles = formData.getAll("guestInstagram");
  return {
    guests: Array.from({ length: Math.max(names.length, handles.length) }, (_, index) => ({
      name: names[index],
      instagram: handles[index],
    })),
    hasAllergies: formData.get("hasAllergies") ?? undefined,
    allergies: formData.get("allergies") ?? undefined,
    notes: formData.get("notes"),
  };
}

export function readSendMessage(formData: FormData): boolean {
  return formData.get("sendMessage") === "on";
}

export function readReservationReplacement(formData: FormData) {
  return {
    replacementMode: formData.get("replacementMode") ?? "auto",
    replacementEntryId: formData.get("replacementEntryId"),
    expectedPromotedEntryIds: formData.getAll("expectedPromotedEntryIds"),
  };
}
