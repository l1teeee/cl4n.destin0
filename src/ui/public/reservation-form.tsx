"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useEffect, useState } from "react";
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
}

const inputClassName =
  "w-full rounded border border-zinc-600 bg-black px-3 py-2 text-zinc-100 disabled:opacity-60";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-red-300">{message}</p> : null;
}

export function ReservationForm({ eventSlug, maxPartySize, formattedDate }: ReservationFormProps) {
  const [turnstile, setTurnstile] = useState<TurnstileInstance | null>(null);
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
      turnstile?.reset();
      setTurnstileToken(null);
      applyFormState({
        kind: "error",
        message: "No pudimos conectar con el servidor. Inténtalo de nuevo.",
        fieldErrors: {},
        automaticRetry: false,
      });
      return;
    }

    turnstile?.reset();
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
        const freshToken = await turnstile?.getResponsePromise(30_000);
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
      <section className="flex flex-col items-center gap-4 text-center" aria-live="polite">
        <h2 className="text-2xl font-semibold">SOLICITUD CONFIRMADA</h2>
        <p className="text-xl font-medium">
          #{String(formState.reservationNumber).padStart(3, "0")}
        </p>
        <p>{formState.partySize} personas</p>
        <p>{formattedDate}</p>
      </section>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex w-full max-w-lg flex-col gap-5"
      noValidate
    >
      <div>
        <label htmlFor="fullName" className="mb-1 block">
          Nombre completo
        </label>
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
        <label htmlFor="instagram" className="mb-1 block">
          Usuario de Instagram
        </label>
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
        <label htmlFor="phone" className="mb-1 block">
          Teléfono
        </label>
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
        <label htmlFor="email" className="mb-1 block">
          Email
        </label>
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
        <label htmlFor="partySize" className="mb-1 block">
          Cantidad de personas
        </label>
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
        <label htmlFor="notes" className="mb-1 block">
          Observaciones (opcional)
        </label>
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
        <div className="flex items-start gap-3">
          <input
            id="acceptTerms"
            type="checkbox"
            className="mt-1 h-4 w-4"
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
          ref={(instance) => setTurnstile(instance ?? null)}
          siteKey={siteKey}
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

      <div aria-live="polite" className="min-h-6">
        {formState?.kind === "error" ? <p>{formState.message}</p> : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !turnstileToken || !idempotencyKey}
        className="border border-current px-5 py-3 font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? "ENVIANDO..." : "SOLICITAR ACCESO"}
      </button>
    </form>
  );
}
