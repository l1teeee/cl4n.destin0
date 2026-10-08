import { describe, expect, it, vi } from "vitest";

import type { EmailSender } from "@/application/ports/email-sender";
import { createReservationConfirmationSender } from "@/infrastructure/email/reservation-notifications";
import { reservationConfirmationEmail } from "@/infrastructure/email/templates/reservation-confirmation-email";

describe("createReservationConfirmationSender", () => {
  it("sends the rendered reservation confirmation to the guest", async () => {
    const send = vi.fn<EmailSender["send"]>().mockResolvedValue(undefined);
    const reservation = {
      email: "ana@example.com",
      fullName: "Ana Perez",
      reservationNumber: 7,
      partySize: 3,
      eventStartsAt: new Date("2026-11-14T02:00:00.000Z"),
    };

    await createReservationConfirmationSender({ send })(reservation);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      to: { email: reservation.email, name: reservation.fullName },
      ...reservationConfirmationEmail(reservation),
    });
  });
});
