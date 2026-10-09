"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import SlideCommit from "@/ui/primitives/slide-commit";

import {
  getOrCreateAttemptKey,
  rotateAttemptKey,
  shouldRotateAttemptKey,
} from "./reservation-idempotency";
import {
  reservationFormFields,
  toFormState,
  type ReservationFormField,
  type ReservationFormState,
} from "./reservation-form-state";
import {
  reservationFormSchema,
  type ReservationFormInput,
  type ReservationFormValues,
} from "./reservation-form-schema";

interface ReservationFormProps {
  eventSlug: string;
  maxPartySize: number;
  formattedDate: string;
  nonce?: string;
}

type ConfirmedReservationState = Extract<
  ReservationFormState,
  { kind: "success" | "waitlisted" | "full" }
>;

const inputClassName = "reservation-input";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatPartySize(partySize: number): string {
  return partySize === 1 ? "1 persona" : `${partySize} personas`;
}

function FieldError({ message, id }: { message?: string; id?: string }) {
  return message ? (
    <p id={id} className="text-sm text-red-300">
      {message}
    </p>
  ) : null;
}

export function ReservationForm({
  eventSlug,
  maxPartySize,
  formattedDate,
  nonce,
}: ReservationFormProps) {
  const turnstileRef = useRef<TurnstileInstance>(null);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [formState, setFormState] = useState<ReservationFormState | null>(null);
  const [confirmedState, setConfirmedState] = useState<ConfirmedReservationState | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const {
    register,
    handleSubmit,
    clearErrors,
    getFieldState,
    setError,
    setFocus,
    trigger,
    unregister,
    control,
    formState: { errors, isSubmitting, isValid },
  } = useForm<ReservationFormInput, unknown, ReservationFormValues>({
    resolver: zodResolver(reservationFormSchema),
    defaultValues: { partySize: 1 },
    mode: "onTouched",
  });
  const hasAllergies = useWatch({ control, name: "hasAllergies" });

  useEffect(() => {
    let key: string;
    try {
      key = getOrCreateAttemptKey(sessionStorage, eventSlug, () => crypto.randomUUID());
    } catch (error) {
      Sentry.captureException(error);
      // Storage can be full or blocked; an in-memory key keeps in-page retries idempotent and the server's duplicate policy still guards reloads, so the outcome is never hidden.
      key = crypto.randomUUID();
    }
    const timeout = window.setTimeout(() => setIdempotencyKey(key), 0);
    return () => window.clearTimeout(timeout);
  }, [eventSlug]);

  useEffect(() => {
    if (hasAllergies === false) {
      unregister("allergies");
    }
  }, [hasAllergies, unregister]);

  useEffect(
    () => () => {
      clearTimeout(confirmationTimer.current);
    },
    [],
  );

  function rotateKey() {
    let nextKey: string;
    try {
      nextKey = rotateAttemptKey(sessionStorage, eventSlug, () => crypto.randomUUID());
    } catch (error) {
      Sentry.captureException(error);
      nextKey = crypto.randomUUID();
    }
    setIdempotencyKey(nextKey);
    setTurnstileToken(null);
  }

  function applyFormState(nextState: ReservationFormState) {
    clearErrors(reservationFormFields);
    if (nextState.kind === "error") {
      for (const [field, messages] of Object.entries(nextState.fieldErrors)) {
        const message = messages?.[0];
        if (message) {
          setError(field as ReservationFormField, { type: "server", message });
        }
      }
    }
    setFormState(nextState);
  }

  async function sendReservation(
    fields: ReservationFormValues,
    key: string,
    token: string,
    alreadyRetried: boolean,
  ): Promise<ReservationFormState> {
    const { allergies, ...requestFields } = fields;
    let response: Response;
    try {
      response = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          ...requestFields,
          ...(fields.hasAllergies ? { allergies } : {}),
          eventSlug,
          turnstileToken: token,
        }),
      });
    } catch {
      turnstileRef.current?.reset();
      setTurnstileToken(null);
      const nextState: ReservationFormState = {
        kind: "error",
        message: "No pudimos conectar con el servidor. Inténtalo de nuevo.",
        fieldErrors: {},
        automaticRetry: false,
      };
      applyFormState(nextState);
      return nextState;
    }

    turnstileRef.current?.reset();
    setTurnstileToken(null);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    const nextState = toFormState({
      status: response.status,
      body,
      ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? { retryAfterSeconds } : {}),
    });

    if (
      nextState.kind === "success" ||
      nextState.kind === "waitlisted" ||
      nextState.kind === "full"
    ) {
      setConfirmedState(nextState);
    }

    if (nextState.kind === "error" && nextState.automaticRetry && !alreadyRetried) {
      setFormState({
        ...nextState,
        message: "La solicitud tardó más de lo esperado. Reintentando...",
      });
      await delay((retryAfterSeconds > 0 ? retryAfterSeconds : 1) * 1000);
      try {
        const freshToken = await turnstileRef.current?.getResponsePromise(30_000);
        if (freshToken) {
          return await sendReservation(fields, key, freshToken, true);
        }
      } catch {
        applyFormState(nextState);
        return nextState;
      }
    }

    applyFormState(nextState);
    const code = nextState.kind === "error" ? nextState.code : undefined;
    if (shouldRotateAttemptKey({ status: response.status, ...(code ? { code } : {}) })) {
      rotateKey();
    }
    return nextState;
  }

  async function onSubmit(fields: ReservationFormValues): Promise<ReservationFormState> {
    if (!idempotencyKey || !turnstileToken) {
      throw new Error("Reservation verification is not ready.");
    }

    clearErrors();
    setFormState(null);
    return await sendReservation(fields, idempotencyKey, turnstileToken, false);
  }

  async function confirmReservation(): Promise<ReservationFormState> {
    let result: ReservationFormState | undefined;
    await handleSubmit(async (fields) => {
      result = await onSubmit(fields);
    })();

    if (!result || result.kind === "error") {
      throw result ?? new Error("Reservation submission did not return a result.");
    }
    return result;
  }

  async function showAllFieldErrors() {
    if (isValid || isSubmitting) return;

    const valid = await trigger();
    if (valid) return;

    const firstInvalidField = reservationFormFields.find((field) => getFieldState(field).invalid);
    if (firstInvalidField) setFocus(firstInvalidField);
  }

  function showConfirmationAfterDone() {
    clearTimeout(confirmationTimer.current);
    confirmationTimer.current = setTimeout(() => setShowConfirmation(true), 700);
  }

  if (showConfirmation && confirmedState?.kind === "success") {
    const reservationNumber = String(confirmedState.reservationNumber).padStart(3, "0");
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>REGISTRO COMPLETADO</h2>
        <p className="reservation-success-lead">Confirmamos tu reserva. No le digas a nadie.</p>
        <p>La ubicación llegará a tu correo cuando el clan la revele.</p>
        <p className="reservation-success-details">
          #{reservationNumber} · {formatPartySize(confirmedState.partySize)} · {formattedDate}
        </p>
      </section>
    );
  }

  if (showConfirmation && confirmedState?.kind === "waitlisted") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>ESTÁS EN LA COLA</h2>
        <p className="reservation-success-lead">
          Registramos tu solicitud, pero los lugares ya se llenaron. Quedaste en la posición #
          {confirmedState.position} de la cola.
        </p>
        <p>Si se libera un lugar te escribiremos. No le digas a nadie.</p>
        <p className="reservation-success-details">
          {formatPartySize(confirmedState.partySize)} · {formattedDate}
        </p>
      </section>
    );
  }

  if (showConfirmation && confirmedState?.kind === "full") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>SIN LUGARES DISPONIBLES</h2>
        <p className="reservation-success-lead">
          Registramos tu solicitud, pero ya no hay lugares disponibles para tu grupo.
        </p>
        <p>Mantente atento a la próxima apertura del clan.</p>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => event.preventDefault()} className="reservation-form" noValidate>
      <div>
        <label htmlFor="fullName">Nombre completo</label>
        <input
          id="fullName"
          autoComplete="name"
          className={inputClassName}
          aria-invalid={Boolean(errors.fullName)}
          {...register("fullName")}
        />
        <FieldError message={errors.fullName?.message} />
      </div>

      <div>
        <label htmlFor="instagram">Usuario de Instagram</label>
        <input
          id="instagram"
          autoComplete="off"
          className={inputClassName}
          aria-invalid={Boolean(errors.instagram)}
          {...register("instagram")}
        />
        <FieldError message={errors.instagram?.message} />
      </div>

      <div>
        <label htmlFor="phone">Teléfono</label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          className={inputClassName}
          aria-invalid={Boolean(errors.phone)}
          {...register("phone")}
        />
        <FieldError message={errors.phone?.message} />
      </div>

      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className={inputClassName}
          aria-invalid={Boolean(errors.email)}
          {...register("email")}
        />
        <FieldError message={errors.email?.message} />
      </div>

      <div>
        <label htmlFor="partySize">Cantidad de personas</label>
        <select
          id="partySize"
          className={inputClassName}
          aria-invalid={Boolean(errors.partySize)}
          {...register("partySize", { valueAsNumber: true })}
        >
          {Array.from({ length: maxPartySize }, (_, index) => index + 1).map((partySize) => (
            <option key={partySize} value={partySize}>
              {partySize}
            </option>
          ))}
        </select>
        <FieldError message={errors.partySize?.message} />
      </div>

      <fieldset
        className="reservation-allergies"
        role="radiogroup"
        aria-invalid={Boolean(errors.hasAllergies)}
        aria-describedby={errors.hasAllergies ? "hasAllergies-error" : undefined}
      >
        <legend>¿Tienes alergias?</legend>
        <Controller
          control={control}
          name="hasAllergies"
          render={({ field }) => (
            <div className="reservation-allergy-options">
              <label className="reservation-terms">
                <input
                  ref={field.ref}
                  name={field.name}
                  type="radio"
                  checked={field.value === false}
                  required
                  onBlur={field.onBlur}
                  onChange={() => field.onChange(false)}
                />
                <span>No</span>
              </label>
              <label className="reservation-terms">
                <input
                  name={field.name}
                  type="radio"
                  checked={field.value === true}
                  required
                  onBlur={field.onBlur}
                  onChange={() => field.onChange(true)}
                />
                <span>Sí</span>
              </label>
            </div>
          )}
        />
        <FieldError id="hasAllergies-error" message={errors.hasAllergies?.message} />
      </fieldset>

      {hasAllergies ? (
        <div>
          <label htmlFor="allergies">¿A qué?</label>
          <textarea
            id="allergies"
            rows={3}
            maxLength={300}
            className={inputClassName}
            aria-invalid={Boolean(errors.allergies)}
            aria-describedby={
              errors.allergies ? "allergies-help allergies-error" : "allergies-help"
            }
            {...register("allergies")}
          />
          <p id="allergies-help" className="reservation-help">
            Incluye las de tu grupo si vienes acompañado.
          </p>
          <FieldError id="allergies-error" message={errors.allergies?.message} />
        </div>
      ) : null}

      <div>
        <label htmlFor="notes">Observaciones (opcional)</label>
        <textarea
          id="notes"
          rows={4}
          className={inputClassName}
          aria-invalid={Boolean(errors.notes)}
          {...register("notes")}
        />
        <FieldError message={errors.notes?.message} />
      </div>

      <div>
        <div className="reservation-terms">
          <input
            id="acceptTerms"
            type="checkbox"
            aria-invalid={Boolean(errors.acceptTerms)}
            {...register("acceptTerms")}
          />
          <label htmlFor="acceptTerms">
            Acepto los <Link href="/terminos">términos</Link> y la{" "}
            <Link href="/privacidad">política de privacidad</Link>
          </label>
        </div>
        <FieldError message={errors.acceptTerms?.message} />
      </div>

      {idempotencyKey && siteKey && !confirmedState ? (
        <Turnstile
          key={idempotencyKey}
          ref={turnstileRef}
          siteKey={siteKey}
          scriptOptions={{ nonce }}
          options={{ action: "reserve", cData: idempotencyKey, refreshExpired: "auto" }}
          onSuccess={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
          onError={() => {
            setTurnstileToken(null);
            setFormState({
              kind: "error",
              message: "No pudimos cargar la verificación. Inténtalo de nuevo.",
              fieldErrors: {},
              automaticRetry: false,
            });
          }}
        />
      ) : null}

      {!siteKey ? <p role="alert">La verificación de seguridad no está disponible.</p> : null}

      <div aria-live="polite" className="reservation-message">
        {formState?.kind === "error" ? <p>{formState.message}</p> : null}
      </div>

      <div className="reservation-slide" onClick={() => void showAllFieldErrors()}>
        <SlideCommit
          label={
            !isValid
              ? "COMPLETA EL FORMULARIO"
              : !turnstileToken || !idempotencyKey
                ? "VERIFICANDO..."
                : "DESLIZA PARA SOLICITAR ACCESO"
          }
          doneLabel="ENVIADO"
          errorLabel="NO SE PUDO ENVIAR"
          onConfirm={confirmReservation}
          onDone={showConfirmationAfterDone}
          trackColor="transparent"
          handleColor="#fffbf4"
          successColor="#fffbf4"
          dangerColor="#fca5a5"
          height={56}
          radius={28}
          holdMs={700}
          disabled={!isValid || !turnstileToken || !idempotencyKey || isSubmitting}
          fluid
          aria-describedby="reservation-slide-hint"
        />
        <p id="reservation-slide-hint" className="reservation-slide-hint">
          Desliza el control hasta el final o pulsa Fin para enviar.
        </p>
      </div>
    </form>
  );
}
