export const reservationErrorCodes = [
  "IDEMPOTENCY_KEY_REQUIRED",
  "VALIDATION_FAILED",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "BOT_CHECK_FAILED",
  "EVENT_NOT_FOUND",
  "EVENT_NOT_OPEN",
  "PARTY_SIZE_NOT_ALLOWED",
  "DUPLICATE_RESERVATION",
  "EVENT_FULL",
  "TRY_AGAIN",
  "INTERNAL_ERROR",
] as const;

export type ReservationErrorCode = (typeof reservationErrorCodes)[number];

export type ReservationOutcome =
  | {
      ok: true;
      status: "CONFIRMED";
      reservation: {
        number: number;
        partySize: number;
        eventStartsAt: Date;
      };
    }
  | {
      ok: false;
      error: {
        code: ReservationErrorCode;
        message: string;
      };
    };
