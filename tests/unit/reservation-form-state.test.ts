import { describe, expect, it } from "vitest";

import { toFormState } from "@/ui/public/reservation-form-state";

function errorBody(code: string, message = "Mensaje del servidor", fields?: unknown) {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}

describe("toFormState", () => {
  it("maps a 201 response and an idempotent replay to the same success", () => {
    const response = {
      status: 201,
      body: {
        status: "CONFIRMED",
        reservation: { number: 7, partySize: 2, eventStartsAt: "2026-11-22T01:30:00.000Z" },
      },
    };

    expect(toFormState(response)).toEqual({
      kind: "success",
      reservationNumber: 7,
      partySize: 2,
    });
    expect(toFormState(response)).toEqual(toFormState(response));
  });

  it("maps a 202 WAITLISTED response to the queue state", () => {
    expect(
      toFormState({
        status: 202,
        body: {
          status: "WAITLISTED",
          waitlist: { position: 3, partySize: 2, eventStartsAt: "2026-11-22T01:30:00.000Z" },
        },
      }),
    ).toEqual({ kind: "waitlisted", position: 3, partySize: 2 });
  });

  it("does not treat a malformed 202 as a queue state", () => {
    expect(toFormState({ status: 202, body: { status: "WAITLISTED" } })).toMatchObject({
      kind: "error",
    });
  });

  it("maps EVENT_FULL to the terminal full outcome", () => {
    expect(toFormState({ status: 409, body: errorBody("EVENT_FULL") })).toEqual({ kind: "full" });
  });

  it("maps DUPLICATE_RESERVATION", () => {
    expect(toFormState({ status: 409, body: errorBody("DUPLICATE_RESERVATION") })).toMatchObject({
      message: "Ya existe una reservación o un lugar en la cola con este email o teléfono.",
    });
  });

  it.each([
    [409, "EVENT_NOT_OPEN"],
    [404, "EVENT_NOT_FOUND"],
  ])("maps closed response %s %s", (status, code) => {
    expect(toFormState({ status, body: errorBody(code) })).toMatchObject({
      message: "El clan está cerrado en este momento.",
    });
  });

  it("maps matching VALIDATION_FAILED fields and ignores unknown fields", () => {
    expect(
      toFormState({
        status: 422,
        body: errorBody("VALIDATION_FAILED", "Revisa estos datos.", {
          email: ["Email inválido."],
          eventSlug: ["No debe mostrarse."],
        }),
      }),
    ).toEqual({
      kind: "error",
      message: "Revisa estos datos.",
      fieldErrors: { email: ["Email inválido."] },
      code: "VALIDATION_FAILED",
      automaticRetry: false,
    });
  });

  it("maps allergy validation errors to both form fields", () => {
    expect(
      toFormState({
        status: 422,
        body: errorBody("VALIDATION_FAILED", "Revisa estos datos.", {
          hasAllergies: ["Indica si tienes alergias."],
          allergies: ["Cuéntanos a qué eres alérgico."],
        }),
      }),
    ).toMatchObject({
      fieldErrors: {
        hasAllergies: ["Indica si tienes alergias."],
        allergies: ["Cuéntanos a qué eres alérgico."],
      },
    });
  });

  it("maps PARTY_SIZE_NOT_ALLOWED to partySize", () => {
    expect(
      toFormState({ status: 422, body: errorBody("PARTY_SIZE_NOT_ALLOWED", "Máximo 2.") }),
    ).toMatchObject({ fieldErrors: { partySize: ["Máximo 2."] } });
  });

  it("asks for a new submission after IDEMPOTENCY_KEY_REUSED", () => {
    expect(toFormState({ status: 422, body: errorBody("IDEMPOTENCY_KEY_REUSED") })).toMatchObject({
      message: "La solicitud cambió. Verifica los datos y envíala de nuevo.",
    });
  });

  it("uses Retry-After for 429", () => {
    expect(
      toFormState({ status: 429, body: errorBody("RATE_LIMITED"), retryAfterSeconds: 12 }),
    ).toMatchObject({ message: "Demasiados intentos. Intenta de nuevo en 12 segundos." });
  });

  it("maps BOT_CHECK_FAILED", () => {
    expect(toFormState({ status: 403, body: errorBody("BOT_CHECK_FAILED") })).toMatchObject({
      message: "No pudimos verificar la solicitud. Inténtalo de nuevo.",
      automaticRetry: false,
    });
  });

  it("marks TRY_AGAIN for one automatic retry and prefers the server message", () => {
    expect(
      toFormState({ status: 503, body: errorBody("TRY_AGAIN", "Espera un momento.") }),
    ).toMatchObject({ message: "Espera un momento.", automaticRetry: true });
  });

  it("allows retry after a 500 and prefers the server message", () => {
    expect(
      toFormState({ status: 500, body: errorBody("INTERNAL_ERROR", "Error temporal.") }),
    ).toMatchObject({
      message: "Error temporal.",
      automaticRetry: false,
      code: "INTERNAL_ERROR",
    });
  });
});
