import type { ReservationErrorCode } from "@/domain/reservation/reservation-outcome";

// The order is the visual order of the form: the first invalid field in this list receives focus.
export const reservationFormFields = [
  "partySize",
  "guest1Name",
  "guest1Instagram",
  "guest2Name",
  "guest2Instagram",
  "hasAllergies",
  "allergies",
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
      kind: "received";
      requestNumber: number;
      partySize: number;
      linkCode: string;
    }
  | {
      kind: "waitlisted";
      position: number;
      partySize: number;
      linkCode: string;
    }
  | { kind: "full"; reason: "full-rejected" | "event-full" }
  | { kind: "closed" }
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
    const request = record(body?.request);
    if (
      typeof request?.number === "number" &&
      typeof request.partySize === "number" &&
      typeof request.linkCode === "string"
    ) {
      return {
        kind: "received",
        requestNumber: request.number,
        partySize: request.partySize,
        linkCode: request.linkCode,
      };
    }
  }

  if (response.status === 202) {
    const waitlist = record(body?.waitlist);
    if (
      typeof waitlist?.position === "number" &&
      typeof waitlist.partySize === "number" &&
      typeof waitlist.linkCode === "string"
    ) {
      return {
        kind: "waitlisted",
        position: waitlist.position,
        partySize: waitlist.partySize,
        linkCode: waitlist.linkCode,
      };
    }
  }

  const error = parsedError(body);
  if (response.status === 409 && error.code === "EVENT_FULL") {
    return { kind: "full", reason: "event-full" };
  }
  if (body?.status === "FULL_REJECTED") {
    return { kind: "full", reason: "full-rejected" };
  }
  if (response.status === 409 && error.code === "DUPLICATE_RESERVATION") {
    return errorState("Ya existe una solicitud con este usuario de Instagram.", error);
  }
  if (response.status === 409 && error.code === "EVENT_NOT_OPEN") {
    return { kind: "closed" };
  }
  if (response.status === 404) {
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
