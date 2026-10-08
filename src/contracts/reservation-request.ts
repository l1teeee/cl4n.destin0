import { z } from "zod";

import type { ReservationErrorCode } from "@/domain/reservation/reservation-outcome";

const controlCharacters = /[\u0000-\u001f\u007f]/;
const noteControlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const controlCharacterMessage = "No se permiten caracteres de control.";

export const reservationRequestBaseSchema = z
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
    fullName: z
      .string({ error: "El nombre completo es obligatorio." })
      .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
      .trim()
      .min(1, "El nombre completo es obligatorio.")
      .max(120, "El nombre completo no puede superar 120 caracteres."),
    instagram: z
      .string({ error: "El usuario de Instagram es obligatorio." })
      .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
      .trim()
      .min(1, "El usuario de Instagram es obligatorio."),
    phone: z
      .string({ error: "El teléfono es obligatorio." })
      .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
      .trim()
      .min(1, "El teléfono es obligatorio."),
    email: z
      .string({ error: "El email es obligatorio." })
      .refine((value) => !controlCharacters.test(value), controlCharacterMessage)
      .trim()
      .max(254, "El email no puede superar 254 caracteres.")
      .email("Ingresa un email válido."),
    partySize: z
      .number({ error: "La cantidad de personas debe ser un número." })
      .int("La cantidad de personas debe ser un número entero.")
      .min(1, "La cantidad de personas debe ser al menos 1.")
      .max(20, "La cantidad de personas no puede superar 20."),
    hasAllergies: z.boolean({ error: "Indica si tienes alergias." }),
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

export function validateAllergies(
  input: { hasAllergies: boolean; allergies?: string },
  context: z.RefinementCtx,
): void {
  if (input.hasAllergies && !input.allergies) {
    context.addIssue({
      code: "custom",
      message: "Cuéntanos a qué eres alérgico.",
      path: ["allergies"],
    });
  }
}

export const reservationRequestSchema = reservationRequestBaseSchema.superRefine(validateAllergies);

export type ReservationRequestInput = z.input<typeof reservationRequestSchema>;
export type ReservationRequest = z.output<typeof reservationRequestSchema>;

export interface ReservationSuccessResponseBody {
  status: "CONFIRMED";
  reservation: {
    number: number;
    partySize: number;
    eventStartsAt: string;
  };
}

export interface ReservationErrorResponseBody {
  error: {
    code: ReservationErrorCode;
    message: string;
  };
}
