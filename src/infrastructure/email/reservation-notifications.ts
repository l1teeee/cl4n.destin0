import type { EmailSender } from "@/application/ports/email-sender";
import type { ConfirmedReservation } from "@/application/reservations/submit-reservation";

import { emailSender } from "./email-sender";
import { reservationConfirmationEmail } from "./templates/reservation-confirmation-email";

export function createReservationConfirmationSender(sender: EmailSender) {
  return async function sendReservationConfirmation(reservation: ConfirmedReservation) {
    const content = reservationConfirmationEmail(reservation);
    await sender.send({
      to: { email: reservation.email, name: reservation.fullName },
      ...content,
    });
  };
}

const defaultSender = createReservationConfirmationSender(emailSender);

export async function sendReservationConfirmation(
  reservation: ConfirmedReservation,
): Promise<void> {
  await defaultSender(reservation);
}
