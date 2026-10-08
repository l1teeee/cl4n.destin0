import { z } from "zod";

import { reservationRequestBaseSchema, validateAllergies } from "@/contracts/reservation-request";

export const reservationFormSchema = reservationRequestBaseSchema
  .omit({
    eventSlug: true,
    turnstileToken: true,
  })
  .superRefine(validateAllergies);

export type ReservationFormInput = z.input<typeof reservationFormSchema>;
export type ReservationFormValues = z.output<typeof reservationFormSchema>;
