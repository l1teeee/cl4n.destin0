import { z } from "zod";

import { guestRequestBaseSchema, validateGuestRequest } from "@/contracts/guest-request";
import { publicMessages, type PublicMessages } from "./i18n/messages";

// The form resolver reports the first branch of a union, as "Invalid input: expected 1", instead of
// the message of the contract's partySize union. One literal with the same values and message
// puts the sentence the guest should read on the field.
const partySizeChoice = z.literal([1, 2], publicMessages.es.reservation.validation.partyChoice);

const reservationFormBaseSchema = guestRequestBaseSchema
  .omit({ eventSlug: true, turnstileToken: true })
  .extend({ partySize: partySizeChoice });

// validateGuestRequest is typed for the whole request body. The browser adds these two fields
// only when it sends, and the validation never reads them.
const serverComposedFields = { eventSlug: "", turnstileToken: "" };

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
    validateGuestRequest({ ...input, ...serverComposedFields }, context);

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
