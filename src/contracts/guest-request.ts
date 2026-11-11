import { z } from "zod";

import { normalizeInstagram } from "@/domain/reservation/contact-normalization";
import { MAX_PARTY_SIZE } from "@/domain/reservation/request-guests";

export const INVALID_INSTAGRAM_MESSAGE = "Ingresa un usuario de Instagram válido.";

const controlCharacters = /[\u0000-\u001f\u007f]/;
const noteControlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const controlCharacterMessage = "No se permiten caracteres de control.";

export const requiredName = z
  .string({ error: "El nombre completo es obligatorio." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El nombre completo es obligatorio.")
  .max(120, "El nombre completo no puede superar 120 caracteres.");

export const requiredInstagram = z
  .string({ error: "El usuario de Instagram es obligatorio." })
  .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
  .trim()
  .min(1, "El usuario de Instagram es obligatorio.")
  .refine((value) => normalizeInstagram(value).ok, INVALID_INSTAGRAM_MESSAGE);

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
    guests: z
      .array(z.object({ name: requiredName, instagram: requiredInstagram }))
      .min(1)
      .max(MAX_PARTY_SIZE),
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
  if (input.hasAllergies && !input.allergies) {
    context.addIssue({
      code: "custom",
      message:
        input.guests.length > 1
          ? "Cuéntanos quién y a qué es alérgico."
          : "Cuéntanos a qué eres alérgico.",
      path: ["allergies"],
    });
  }

  const handles = new Set<string>();
  for (const [index, guest] of input.guests.entries()) {
    const handle = normalizeInstagram(guest.instagram);
    if (!handle.ok) continue;
    if (handles.has(handle.value)) {
      context.addIssue({
        code: "custom",
        message: "Cada invitado necesita su propio usuario de Instagram.",
        path: ["guests", index, "instagram"],
      });
    }
    handles.add(handle.value);
  }
}

export const guestRequestSchema = guestRequestBaseSchema.superRefine(validateGuestRequest);

export type GuestRequestInput = z.input<typeof guestRequestSchema>;
export type GuestRequest = z.output<typeof guestRequestSchema>;

export function partySizeOf(body: Pick<GuestRequest, "guests">): number {
  return body.guests.length;
}

export interface GuestRequestReceivedBody {
  status: "RECEIVED";
  request: {
    number: number;
    partySize: number;
    eventStartsAt: string;
    linkCode: string;
  };
}

export interface GuestRequestWaitlistedBody {
  status: "WAITLISTED";
  waitlist: {
    position: number;
    partySize: number;
    eventStartsAt: string;
    linkCode: string;
  };
}
