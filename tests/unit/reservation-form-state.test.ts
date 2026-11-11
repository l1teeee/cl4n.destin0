import { describe, expect, it } from "vitest";

import { reservationFormFields, toFormState } from "@/ui/public/reservation-form-state";

function errorBody(code: string, message = "Mensaje del servidor", fields?: unknown) {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}

function receivedBody(partySize = 2) {
  return {
    status: "RECEIVED",
    request: {
      number: 7,
      partySize,
      eventStartsAt: "2026-11-22T01:30:00.000Z",
      linkCode: "K7M2QX",
    },
  };
}

function waitlistedBody() {
  return {
    status: "WAITLISTED",
    waitlist: {
      position: 3,
      partySize: 2,
      eventStartsAt: "2026-11-22T01:30:00.000Z",
      linkCode: "R4T9HB",
    },
  };
}

describe("reservationFormFields", () => {
  it("follows the visual order of the form so the first invalid field gets focus", () => {
    expect(reservationFormFields).toEqual([
      "partySize",
      "guest1Name",
      "guest1Instagram",
      "guest2Name",
      "guest2Instagram",
      "hasAllergies",
      "allergies",
      "notes",
      "acceptTerms",
    ]);
  });
});

describe("toFormState", () => {
  it.each([
    [409, "DUPLICATE_RESERVATION", "A request already exists for this Instagram username."],
    [404, "EVENT_NOT_FOUND", "The clan is currently closed."],
    [422, "VALIDATION_FAILED", "Check the information you submitted and try again."],
    [422, "PARTY_SIZE_NOT_ALLOWED", "The number of people exceeds the allowed maximum."],
    [
      422,
      "IDEMPOTENCY_KEY_REUSED",
      "The request changed. Check the information and submit it again.",
    ],
    [429, "RATE_LIMITED", "Too many attempts. Try again in 12 seconds."],
    [403, "BOT_CHECK_FAILED", "We could not verify the request. Please try again."],
    [503, "TRY_AGAIN", "We could not process the request. Please try again."],
    [500, "INTERNAL_ERROR", "An error occurred. Please try again."],
  ])("uses English copy for %s %s regardless of server language", (status, code, message) => {
    expect(
      toFormState({ status, body: errorBody(code), retryAfterSeconds: 12 }, "en"),
    ).toMatchObject({
      kind: "error",
      code,
      message,
      automaticRetry: code === "TRY_AGAIN",
    });
  });

  it("translates server field errors while ignoring unknown fields", () => {
    expect(
      toFormState(
        {
          status: 422,
          body: errorBody("VALIDATION_FAILED", "Mensaje del servidor", {
            "guests.0.instagram": ["Ingresa un usuario de Instagram válido."],
            "guests.1.name": ["El nombre del invitado 2 es obligatorio."],
            allergies: ["Cuéntanos quién y a qué es alérgico."],
            notes: ["Mensaje futuro del servidor"],
            email: ["No debe mostrarse"],
          }),
        },
        "en",
      ),
    ).toMatchObject({
      fieldErrors: {
        guest1Instagram: ["Enter a valid Instagram username."],
        guest2Name: ["Guest 2's name is required."],
        allergies: ["Tell us who is allergic, and to what."],
        notes: ["Check the information you submitted and try again."],
      },
    });
    const state = toFormState(
      { status: 422, body: errorBody("VALIDATION_FAILED", "", { email: ["No"] }) },
      "en",
    );
    expect(state.kind === "error" && state.fieldErrors).toEqual({});
  });

  it("maps a 201 response and an idempotent replay to the same received state", () => {
    const response = { status: 201, body: receivedBody() };

    expect(toFormState(response)).toEqual({
      kind: "received",
      requestNumber: 7,
      partySize: 2,
      linkCode: "K7M2QX",
    });
    expect(toFormState(response)).toEqual(toFormState(response));
  });

  it("keeps the party size of a single guest", () => {
    expect(toFormState({ status: 201, body: receivedBody(1) })).toMatchObject({
      kind: "received",
      partySize: 1,
    });
  });

  it("does not treat a 201 without a link code as received", () => {
    expect(
      toFormState({
        status: 201,
        body: {
          status: "RECEIVED",
          request: { number: 7, partySize: 2, eventStartsAt: "2026-11-22T01:30:00.000Z" },
        },
      }),
    ).toMatchObject({ kind: "error" });
  });

  it("does not treat the retired reservation body as received", () => {
    expect(
      toFormState({
        status: 201,
        body: {
          status: "CONFIRMED",
          reservation: { number: 7, partySize: 2, eventStartsAt: "2026-11-22T01:30:00.000Z" },
        },
      }),
    ).toMatchObject({ kind: "error" });
  });

  it("maps a 202 WAITLISTED response to the queue state", () => {
    expect(toFormState({ status: 202, body: waitlistedBody() })).toEqual({
      kind: "waitlisted",
      position: 3,
      partySize: 2,
      linkCode: "R4T9HB",
    });
  });

  it("does not treat a malformed 202 as a queue state", () => {
    expect(toFormState({ status: 202, body: { status: "WAITLISTED" } })).toMatchObject({
      kind: "error",
    });
  });

  it("does not treat a 202 without a link code as a queue state", () => {
    expect(
      toFormState({
        status: 202,
        body: {
          status: "WAITLISTED",
          waitlist: { position: 3, partySize: 2, eventStartsAt: "2026-11-22T01:30:00.000Z" },
        },
      }),
    ).toMatchObject({ kind: "error" });
  });

  it("maps EVENT_FULL to the terminal full outcome", () => {
    expect(toFormState({ status: 409, body: errorBody("EVENT_FULL") })).toEqual({
      kind: "full",
      reason: "event-full",
    });
  });

  it("keeps the stored full rejection outcome distinct", () => {
    expect(toFormState({ status: 201, body: { status: "FULL_REJECTED" } })).toEqual({
      kind: "full",
      reason: "full-rejected",
    });
  });

  it("maps DUPLICATE_RESERVATION to the Instagram user message", () => {
    expect(toFormState({ status: 409, body: errorBody("DUPLICATE_RESERVATION") })).toMatchObject({
      kind: "error",
      message: "Ya existe una solicitud con este usuario de Instagram.",
      code: "DUPLICATE_RESERVATION",
      automaticRetry: false,
    });
  });

  it("maps EVENT_NOT_OPEN to the terminal closed outcome", () => {
    expect(toFormState({ status: 409, body: errorBody("EVENT_NOT_OPEN") })).toEqual({
      kind: "closed",
    });
  });

  it("keeps EVENT_NOT_FOUND as a retryable form error", () => {
    expect(toFormState({ status: 404, body: errorBody("EVENT_NOT_FOUND") })).toMatchObject({
      message: "El clan está cerrado en este momento.",
    });
  });

  it("maps matching VALIDATION_FAILED fields and ignores unknown or retired fields", () => {
    expect(
      toFormState({
        status: 422,
        body: errorBody("VALIDATION_FAILED", "Revisa estos datos.", {
          "guests.0.instagram": ["Usuario inválido."],
          "guests.1.name": ["Falta el nombre."],
          "guests.2.instagram": ["Cada invitado necesita su propio usuario de Instagram."],
          email: ["Ya no se pide."],
          phone: ["Ya no se pide."],
          eventSlug: ["No debe mostrarse."],
        }),
      }),
    ).toEqual({
      kind: "error",
      message: "Revisa estos datos.",
      fieldErrors: {
        guest1Instagram: ["Usuario inválido."],
        guest2Name: ["Falta el nombre."],
        "guests.2.instagram": ["Cada invitado necesita su propio usuario de Instagram."],
      },
      code: "VALIDATION_FAILED",
      automaticRetry: false,
    });
  });

  it("maps allergy validation errors to both form fields", () => {
    expect(
      toFormState({
        status: 422,
        body: errorBody("VALIDATION_FAILED", "Revisa estos datos.", {
          hasAllergies: ["Indica si hay alergias."],
          allergies: ["Cuéntanos quién y a qué es alérgico."],
        }),
      }),
    ).toMatchObject({
      fieldErrors: {
        hasAllergies: ["Indica si hay alergias."],
        allergies: ["Cuéntanos quién y a qué es alérgico."],
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
