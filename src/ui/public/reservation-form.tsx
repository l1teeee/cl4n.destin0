"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

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

const inputClassName = "reservation-input";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-red-300">{message}</p> : null;
}

export function ReservationForm({
  eventSlug,
  maxPartySize,
  formattedDate,
  nonce,
}: ReservationFormProps) {
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [formState, setFormState] = useState<ReservationFormState | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const {
    register,
    handleSubmit,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ReservationFormInput, unknown, ReservationFormValues>({
    resolver: zodResolver(reservationFormSchema),
    defaultValues: { partySize: 1 },
  });

  useEffect(() => {
    const key = getOrCreateAttemptKey(sessionStorage, eventSlug, () => crypto.randomUUID());
    const timeout = window.setTimeout(() => setIdempotencyKey(key), 0);
    return () => window.clearTimeout(timeout);
  }, [eventSlug]);

  function rotateKey() {
    const nextKey = rotateAttemptKey(sessionStorage, eventSlug, () => crypto.randomUUID());
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
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ ...fields, eventSlug, turnstileToken: token }),
      });
    } catch {
      turnstileRef.current?.reset();
      setTurnstileToken(null);
      applyFormState({
        kind: "error",
        message: "No pudimos conectar con el servidor. Inténtalo de nuevo.",
        fieldErrors: {},
        automaticRetry: false,
      });
      return;
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

    if (nextState.kind === "error" && nextState.automaticRetry && !alreadyRetried) {
      setFormState({
        ...nextState,
        message: "La solicitud tardó más de lo esperado. Reintentando...",
      });
      await delay((retryAfterSeconds > 0 ? retryAfterSeconds : 1) * 1000);
      try {
        const freshToken = await turnstileRef.current?.getResponsePromise(30_000);
        if (freshToken) {
          await sendReservation(fields, key, freshToken, true);
          return;
        }
      } catch {
        applyFormState(nextState);
        return;
      }
    }

    applyFormState(nextState);
    const code = nextState.kind === "error" ? nextState.code : undefined;
    if (shouldRotateAttemptKey({ status: response.status, ...(code ? { code } : {}) })) {
      rotateKey();
    }
  }

  async function onSubmit(fields: ReservationFormValues) {
    if (!idempotencyKey || !turnstileToken) {
      return;
    }

    clearErrors();
    setFormState(null);
    await sendReservation(fields, idempotencyKey, turnstileToken, false);
  }

  if (formState?.kind === "success") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>SOLICITUD CONFIRMADA</h2>
        <p className="reservation-success-number">
          #{String(formState.reservationNumber).padStart(3, "0")}
        </p>
        <p>{formState.partySize} personas</p>
        <p>{formattedDate}</p>
      </section>
    );
  }

  if (formState?.kind === "waitlisted") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>HAS QUEDADO EN COLA</h2>
        <p className="reservation-success-number">#{formState.position}</p>
        <p>{formState.partySize} personas</p>
        <p>{formattedDate}</p>
        <p>Te avisaremos por correo si se libera un lugar.</p>
      </section>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="reservation-form"
      noValidate
    >
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

      {idempotencyKey && siteKey ? (
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

      <button
        type="submit"
        disabled={isSubmitting || !turnstileToken || !idempotencyKey}
        className="reservation-submit"
      >
        {isSubmitting ? "ENVIANDO..." : "SOLICITAR ACCESO"}
      </button>
    </form>
  );
}
