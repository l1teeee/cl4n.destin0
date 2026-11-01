import { z } from "zod";

import { normalizeInstagram } from "@/domain/reservation/contact-normalization";

export const INVALID_INSTAGRAM_MESSAGE = "Ingresa un usuario de Instagram válido.";

const controlCharacters = /[\u0000-\u001f\u007f]/;
const noteControlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const controlCharacterMessage = "No se permiten caracteres de control.";

const requiredName = z
  .string({ error: "El nombre completo es obligatorio." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El nombre completo es obligatorio.")
  .max(120, "El nombre completo no puede superar 120 caracteres.");

const optionalName = z
  .string({ error: "El nombre completo debe ser texto." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El nombre completo es obligatorio.")
  .max(120, "El nombre completo no puede superar 120 caracteres.")
  .optional();

const requiredInstagram = z
  .string({ error: "El usuario de Instagram es obligatorio." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El usuario de Instagram es obligatorio.")
  .refine((value) => normalizeInstagram(value).ok, INVALID_INSTAGRAM_MESSAGE);

const optionalInstagram = z
  .string({ error: "El usuario de Instagram debe ser texto." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El usuario de Instagram es obligatorio.")
  .refine((value) => normalizeInstagram(value).ok, INVALID_INSTAGRAM_MESSAGE)
  .optional();

export const guestRequestBaseSchema = z
  .object({
    eventSlug: z
      .string({ error: "El evento es obligatorio." })
      .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
      .trim()
      .min(1, "El evento es obligatorio.")
      .max(80, "El evento no puede superar 80 caracteres.")
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "El identificador del evento no tiene un formato válido.",
      ),
    partySize: z.union([z.literal(1), z.literal(2)], {
      error: "Elige si vienes solo o en pareja.",
    }),
    guest1Name: requiredName,
    guest1Instagram: requiredInstagram,
    guest2Name: optionalName,
    guest2Instagram: optionalInstagram,
    hasAllergies: z.boolean({ error: "Indica si hay alergias." }),
    allergies: z
      .string({ error: "La descripción de alergias debe ser texto." })
      .refine((value) => !noteControlCharacters.test(value), controlCharacterMessage)
      .trim()
      .max(300, "La descripción de alergias no puede superar 300 caracteres.")
      .optional(),
    notes: z
      .string({ error: "Las observaciones deben ser texto." })
      .refine((value) => !noteControlCharacters.test(value), controlCharacterMessage)
      .trim()
      .max(500, "Las observaciones no pueden superar 500 caracteres.")
      .optional(),
    acceptTerms: z.literal(true, "Debes aceptar los términos y la política de privacidad."),
    turnstileToken: z
      .string({ error: "La verificación de seguridad es obligatoria." })
      .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
      .min(1, "La verificación de seguridad es obligatoria.")
      .max(2048, "La verificación de seguridad no es válida."),
  })
  .strict();

type GuestRequestValidationInput = z.output<typeof guestRequestBaseSchema>;

export function validateGuestRequest(
  input: GuestRequestValidationInput,
  context: z.RefinementCtx,
): void {
  if (input.partySize === 2) {
    if (!input.guest2Name) {
      context.addIssue({
        code: "custom",
        message: "El nombre del invitado 2 es obligatorio.",
        path: ["guest2Name"],
      });
    }
    if (!input.guest2Instagram) {
      context.addIssue({
        code: "custom",
        message: "El usuario de Instagram del invitado 2 es obligatorio.",
        path: ["guest2Instagram"],
      });
    }
  } else {
    if (input.guest2Name !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Quita los datos del invitado 2 o elige pareja.",
        path: ["guest2Name"],
      });
    }
    if (input.guest2Instagram !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Quita los datos del invitado 2 o elige pareja.",
        path: ["guest2Instagram"],
      });
    }
  }

  if (input.hasAllergies && !input.allergies) {
    context.addIssue({
      code: "custom",
      message:
        input.partySize === 2
          ? "Cuéntanos quién y a qué es alérgico."
          : "Cuéntanos a qué eres alérgico.",
      path: ["allergies"],
    });
  }

  if (input.guest2Instagram) {
    const guest1 = normalizeInstagram(input.guest1Instagram);
    const guest2 = normalizeInstagram(input.guest2Instagram);
    if (guest1.ok && guest2.ok && guest1.value === guest2.value) {
      context.addIssue({
        code: "custom",
        message: "Cada invitado necesita su propio usuario de Instagram.",
        path: ["guest2Instagram"],
      });
    }
  }
}

export const guestRequestSchema = guestRequestBaseSchema.superRefine(validateGuestRequest);

export type GuestRequestInput = z.input<typeof guestRequestSchema>;
export type GuestRequest = z.output<typeof guestRequestSchema>;

export interface GuestRequestReceivedBody {
  status: "RECEIVED";
  request: {
    number: number;
    partySize: 1 | 2;
    eventStartsAt: string;
    linkCode: string;
  };
}

export interface GuestRequestWaitlistedBody {
  status: "WAITLISTED";
  waitlist: {
    position: number;
    partySize: 1 | 2;
    eventStartsAt: string;
    linkCode: string;
  };
}
