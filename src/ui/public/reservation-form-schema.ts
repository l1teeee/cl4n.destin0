import { z } from "zod";

import { guestRequestBaseSchema, validateGuestRequest } from "@/contracts/guest-request";

// The form resolver reports the first branch of a union, as "Invalid input: expected 1", instead of
// the message of the contract's partySize union. One literal with the same values and message
// puts the sentence the guest should read on the field.
const partySizeChoice = z.literal([1, 2], "Elige si vienes solo o en pareja.");

const reservationFormBaseSchema = guestRequestBaseSchema
  .omit({ eventSlug: true, turnstileToken: true })
  .extend({ partySize: partySizeChoice });

// validateGuestRequest is typed for the whole request body. The browser adds these two fields
// only when it sends, and the validation never reads them.
const serverComposedFields = { eventSlug: "", turnstileToken: "" };

export function reservationFormSchema(maxPartySize: number) {
  return reservationFormBaseSchema.superRefine((input, context) => {
    validateGuestRequest({ ...input, ...serverComposedFields }, context);

    if (input.partySize > maxPartySize) {
      context.addIssue({
        code: "custom",
        message: "La cantidad de personas supera el máximo permitido.",
        path: ["partySize"],
      });
    }
  });
}

export type ReservationFormInput = z.input<ReturnType<typeof reservationFormSchema>>;
export type ReservationFormValues = z.output<ReturnType<typeof reservationFormSchema>>;
