import type { ReservationErrorCode } from "@/domain/reservation/reservation-outcome";

export const reservationFormFields = [
  "fullName",
  "instagram",
  "phone",
  "email",
  "partySize",
  "notes",
  "acceptTerms",
] as const;

export type ReservationFormField = (typeof reservationFormFields)[number];

export interface ReservationResponseData {
  status: number;
  body?: unknown;
  retryAfterSeconds?: number;
}

export type ReservationFormState =
  | {
      kind: "success";
      reservationNumber: number;
      partySize: number;
    }
  | {
      kind: "error";
      message: string;
      fieldErrors: Partial<Record<ReservationFormField, string[]>>;
      code?: ReservationErrorCode;
      automaticRetry: boolean;
    };

interface ParsedError {
  code?: ReservationErrorCode;
  message?: string;
  fields?: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function parsedError(body: unknown): ParsedError {
  const error = record(record(body)?.error);
  return {
    ...(typeof error?.code === "string" ? { code: error.code as ReservationErrorCode } : {}),
    ...(typeof error?.message === "string" ? { message: error.message } : {}),
    ...(record(error?.fields) ? { fields: record(error?.fields) } : {}),
  };
}

function matchingFieldErrors(
  fields: Record<string, unknown> | undefined,
): Partial<Record<ReservationFormField, string[]>> {
  const result: Partial<Record<ReservationFormField, string[]>> = {};
  if (!fields) {
    return result;
  }

  for (const field of reservationFormFields) {
    const messages = fields[field];
    if (Array.isArray(messages) && messages.every((message) => typeof message === "string")) {
      result[field] = messages;
    }
  }
  return result;
}

function errorState(
  message: string,
  error: ParsedError,
  options: {
    fieldErrors?: Partial<Record<ReservationFormField, string[]>>;
    automaticRetry?: boolean;
  } = {},
): ReservationFormState {
  return {
    kind: "error",
    message,
    fieldErrors: options.fieldErrors ?? {},
    ...(error.code ? { code: error.code } : {}),
    automaticRetry: options.automaticRetry ?? false,
  };
}

export function toFormState(response: ReservationResponseData): ReservationFormState {
  const body = record(response.body);
  if (response.status === 201) {
    const reservation = record(body?.reservation);
    if (typeof reservation?.number === "number" && typeof reservation.partySize === "number") {
      return {
        kind: "success",
        reservationNumber: reservation.number,
        partySize: reservation.partySize,
      };
    }
  }

  const error = parsedError(body);
  if (response.status === 409 && error.code === "EVENT_FULL") {
    return errorState("Los cupos para esta experiencia se agotaron.", error);
  }
  if (response.status === 409 && error.code === "DUPLICATE_RESERVATION") {
    return errorState(
      "Ya existe una reservación con este email o teléfono para esta experiencia.",
      error,
    );
  }
  if (response.status === 404 || (response.status === 409 && error.code === "EVENT_NOT_OPEN")) {
    return errorState("El clan está cerrado en este momento.", error);
  }
  if (response.status === 422 && error.code === "VALIDATION_FAILED") {
    return errorState(error.message ?? "Revisa los datos enviados e intenta de nuevo.", error, {
      fieldErrors: matchingFieldErrors(error.fields),
    });
  }
  if (response.status === 422 && error.code === "PARTY_SIZE_NOT_ALLOWED") {
    const message = error.message ?? "La cantidad de personas supera el máximo permitido.";
    return errorState(message, error, { fieldErrors: { partySize: [message] } });
  }
  if (response.status === 422 && error.code === "IDEMPOTENCY_KEY_REUSED") {
    return errorState("La solicitud cambió. Verifica los datos y envíala de nuevo.", error);
  }
  if (response.status === 429) {
    const seconds = response.retryAfterSeconds ?? 1;
    return errorState(`Demasiados intentos. Intenta de nuevo en ${seconds} segundos.`, error);
  }
  if (response.status === 403 && error.code === "BOT_CHECK_FAILED") {
    return errorState("No pudimos verificar la solicitud. Inténtalo de nuevo.", error);
  }
  if (response.status === 503 && error.code === "TRY_AGAIN") {
    return errorState(
      error.message ?? "No pudimos procesar la solicitud. Intenta de nuevo.",
      error,
      {
        automaticRetry: true,
      },
    );
  }

  return errorState(error.message ?? "Ocurrió un error. Inténtalo de nuevo.", error);
}
