import { z } from "zod";

import { reservationRequestSchema } from "@/contracts/reservation-request";

export const reservationFormSchema = reservationRequestSchema.omit({
  eventSlug: true,
  turnstileToken: true,
});

export type ReservationFormInput = z.input<typeof reservationFormSchema>;
export type ReservationFormValues = z.output<typeof reservationFormSchema>;
