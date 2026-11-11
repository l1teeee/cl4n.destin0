import { z } from "zod";

import { guestRequestBaseSchema, requiredInstagram, requiredName } from "@/contracts/guest-request";
import { hasDuplicateHandles } from "@/domain/reservation/request-guests";
import { publicMessages, type PublicMessages } from "./i18n/messages";

// The form resolver reports the first branch of a union, as "Invalid input: expected 1", instead of
// the message of the contract's partySize union. One literal with the same values and message
// puts the sentence the guest should read on the field.
const partySizeChoice = z.literal([1, 2], publicMessages.es.reservation.validation.partyChoice);

const reservationFormBaseSchema = guestRequestBaseSchema
  .omit({ eventSlug: true, turnstileToken: true, guests: true })
  .extend({
    partySize: partySizeChoice,
    guest1Name: requiredName,
    guest1Instagram: requiredInstagram,
    guest2Name: requiredName.optional(),
    guest2Instagram: requiredInstagram.optional(),
  });

export function translateReservationValidation(
  message: string,
  messages: PublicMessages["reservation"],
): string {
  const source = publicMessages.es.reservation.validation;
  for (const key of Object.keys(source) as Array<keyof typeof source>) {
    if (source[key] === message) {
      return messages.validation[key];
    }
  }
  if (message === publicMessages.es.reservation.errors.partySize) {
    return messages.errors.partySize;
  }
  return messages.errors.validation;
}

export function reservationFormSchema(
  maxPartySize: number,
  messages: PublicMessages["reservation"] = publicMessages.es.reservation,
) {
  const schema = reservationFormBaseSchema.superRefine((input, context) => {
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
      for (const field of ["guest2Name", "guest2Instagram"] as const) {
        if (input[field] !== undefined) {
          context.addIssue({
            code: "custom",
            message: "Quita los datos del invitado 2 o elige pareja.",
            path: [field],
          });
        }
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
    if (
      input.guest2Instagram &&
      hasDuplicateHandles([input.guest1Instagram, input.guest2Instagram])
    ) {
      context.addIssue({
        code: "custom",
        message: "Cada invitado necesita su propio usuario de Instagram.",
        path: ["guest2Instagram"],
      });
    }

    if (input.partySize > maxPartySize) {
      context.addIssue({
        code: "custom",
        message: publicMessages.es.reservation.errors.partySize,
        path: ["partySize"],
      });
    }
  });

  // Translate explicit contract messages without changing the shared server schema or its rules.
  return z.custom<ReservationFormInput>().transform((input, context) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          ...issue,
          message: translateReservationValidation(issue.message, messages),
        });
      }
      return z.NEVER;
    }
    return result.data;
  });
}

export type ReservationFormInput = z.input<typeof reservationFormBaseSchema>;
export type ReservationFormValues = z.output<typeof reservationFormBaseSchema>;
