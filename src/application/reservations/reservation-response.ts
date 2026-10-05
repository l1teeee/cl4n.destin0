import type {
  AllocationOutcome,
  ReservationResponse,
} from "@/application/ports/reservation-allocation-repository";
import type { ReservationErrorCode } from "@/domain/reservation/reservation-outcome";

export interface ReservationResponseOutcome {
  code: ReservationErrorCode;
  fieldErrors?: Record<string, string[]>;
  reason?: "TOKEN_EXPIRED_OR_SPENT";
  retryAfterSeconds?: number;
  requestId?: string;
}

const responseDefinitions: Record<ReservationErrorCode, { status: number; message: string }> = {
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    message: "Se requiere una clave de idempotencia válida.",
  },
  VALIDATION_FAILED: {
    status: 422,
    message: "Revisa los datos enviados e intenta de nuevo.",
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message: "La clave de idempotencia ya se usó con otros datos.",
  },
  RATE_LIMITED: {
    status: 429,
    message: "Has enviado demasiadas solicitudes. Intenta de nuevo más tarde.",
  },
  BOT_CHECK_FAILED: {
    status: 403,
    message: "No se pudo completar la verificación de seguridad.",
  },
  EVENT_NOT_FOUND: {
    status: 404,
    message: "La experiencia solicitada no existe.",
  },
  EVENT_NOT_OPEN: {
    status: 409,
    message: "El clan no está abierto en este momento.",
  },
  PARTY_SIZE_NOT_ALLOWED: {
    status: 422,
    message: "La cantidad de personas supera el máximo permitido.",
  },
  DUPLICATE_RESERVATION: {
    status: 409,
    message: "Ya existe una reservación confirmada con este email o teléfono.",
  },
  EVENT_FULL: {
    status: 409,
    message: "Los cupos para esta experiencia se agotaron.",
  },
  TRY_AGAIN: {
    status: 503,
    message: "No pudimos procesar la solicitud. Intenta de nuevo.",
  },
  INTERNAL_ERROR: {
    status: 500,
    message: "Ocurrió un error inesperado.",
  },
};

export function mapReservationOutcome(
  outcome: AllocationOutcome | ReservationResponseOutcome,
): ReservationResponse {
  if (outcome.code === "CONFIRMED") {
    return {
      status: 201,
      body: {
        status: "CONFIRMED",
        reservation: {
          number: outcome.number,
          partySize: outcome.partySize,
          eventStartsAt: outcome.eventStartsAt.toISOString(),
        },
      },
    };
  }

  const definition = responseDefinitions[outcome.code];
  const error: Record<string, unknown> = {
    code: outcome.code,
    message: definition.message,
  };

  if ("fieldErrors" in outcome && outcome.fieldErrors) {
    error.fields = outcome.fieldErrors;
  }
  if ("reason" in outcome && outcome.reason) {
    error.reason = outcome.reason;
  }
  if ("requestId" in outcome && outcome.requestId) {
    error.requestId = outcome.requestId;
  }

  return {
    status: definition.status,
    body: { error },
    ...("retryAfterSeconds" in outcome && outcome.retryAfterSeconds
      ? { retryAfterSeconds: outcome.retryAfterSeconds }
      : {}),
  };
}
