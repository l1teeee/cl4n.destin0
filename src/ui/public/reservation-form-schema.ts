import { z } from "zod";

import { reservationRequestBaseSchema, validateAllergies } from "@/contracts/reservation-request";
import { normalizePhone } from "@/domain/reservation/contact-normalization";

const reservationFormBaseSchema = reservationRequestBaseSchema.omit({
  eventSlug: true,
  turnstileToken: true,
});

export function reservationFormSchema(maxPartySize: number) {
  return reservationFormBaseSchema.superRefine((input, context) => {
    validateAllergies(input, context);

    if (!normalizePhone(input.phone).ok) {
      context.addIssue({
        code: "custom",
        message: "Ingresa un teléfono válido.",
        path: ["phone"],
      });
    }

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
