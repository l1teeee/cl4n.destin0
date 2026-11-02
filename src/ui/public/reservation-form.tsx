"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Button } from "@/ui/primitives/button";
import { SegmentedControl, SegmentedControlItem } from "@/ui/primitives/segmented-control";
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
  { kind: "received" | "waitlisted" | "full" | "closed" }
>;

const inputClassName = "reservation-input";

// SlideCommit takes hex colors. They match the light page values in globals.css.
const LIGHT_PAGE_INK = "#11120d";
const LIGHT_PAGE_ERROR = "#b42318";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatPartySize(partySize: number): string {
  return partySize === 1 ? "1 persona" : `${partySize} personas`;
}

// Blank means not configured. A leading @ is dropped so the chat link stays valid.
function configuredInstagramUsername(): string | undefined {
  const username = process.env.NEXT_PUBLIC_INSTAGRAM_USERNAME?.trim().replace(/^@/, "");
  return username ? username : undefined;
}

function allergiesDescription(isCouple: boolean, hasError: boolean): string | undefined {
  const ids: string[] = [];
  if (isCouple) ids.push("allergies-help");
  if (hasError) ids.push("allergies-error");
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function FieldError({ message, id }: { message?: string; id?: string }) {
  return (
    <p
      id={id}
      className="reservation-field-error mt-1 min-h-5 text-sm leading-5"
      aria-live="polite"
    >
      {message ?? ""}
    </p>
  );
}

function InstagramLastStep({
  username,
  linkCode,
}: {
  username: string | undefined;
  linkCode: string;
}) {
  return (
    <div className="reservation-last-step">
      <h3>Último paso</h3>
      {username ? (
        <>
          <p>Para poder escribirte, envíanos un mensaje por Instagram a @{username}.</p>
          <Button asChild>
            <a
              href={`https://ig.me/m/${encodeURIComponent(username)}?ref=${encodeURIComponent(linkCode)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir chat en Instagram
            </a>
          </Button>
        </>
      ) : null}
      <div className="reservation-link-code">
        <p>
          Tu código: <code>{linkCode}</code>
        </p>
        <p className="reservation-help">
          {username
            ? "Si escribes desde la computadora, envíanos este código en el mensaje."
            : "Envíanos este código por mensaje directo en Instagram."}
        </p>
        <p className="reservation-help">
          {
            "Revisa también tus solicitudes de mensajes en Instagram (Mensajes > Solicitudes): si no nos sigues, nuestra respuesta puede llegar ahí."
          }
        </p>
      </div>
    </div>
  );
}

const SECOND_GUEST_TRANSITION_MS = 320;

// Keeps the second guest block in the DOM while it collapses, so the exit can animate.
// The block is only presentation while collapsing; its fields are unregistered by then.
function useSecondGuestTransition(isCouple: boolean) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!isCouple) return;
    let secondFrame = 0;
    // Two frames let the collapsed block paint once, so the expand has a start state.
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        setMounted(true);
        setOpen(true);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [isCouple]);

  useEffect(() => {
    if (isCouple || !mounted) return;
    const timer = setTimeout(() => {
      setMounted(false);
      setOpen(false);
    }, SECOND_GUEST_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [isCouple, mounted]);

  const isCollapsing = !isCouple && mounted;

  function restartCollapsingBlock() {
    // A block that is still collapsing keeps the old text; a new one starts empty.
    setMounted(false);
    setOpen(false);
    setEpoch((current) => current + 1);
  }

  return {
    isRendered: isCouple || mounted,
    isExpanded: isCouple && open,
    isCollapsing,
    epoch,
    restartCollapsingBlock,
  };
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
  const instagramUsername = configuredInstagramUsername();
  const canChoosePartySize = maxPartySize >= 2;
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
    resolver: zodResolver(reservationFormSchema(maxPartySize)),
    defaultValues: { partySize: 1 },
    mode: "onTouched",
  });
  const partySize = useWatch({ control, name: "partySize" });
  const hasAllergies = useWatch({ control, name: "hasAllergies" });
  const isCouple = partySize === 2;
  const secondGuest = useSecondGuestTransition(isCouple);

  function choosePartySize(value: string, onChange: (partySize: number) => void) {
    if (value === "2" && secondGuest.isCollapsing) {
      secondGuest.restartCollapsingBlock();
    }
    onChange(Number(value));
  }

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

  useEffect(() => {
    if (partySize === 1) {
      unregister(["guest2Name", "guest2Instagram"]);
    }
  }, [partySize, unregister]);

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
    const { guest2Name, guest2Instagram, allergies, ...requestFields } = fields;
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
          ...(fields.partySize === 2 ? { guest2Name, guest2Instagram } : {}),
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
      nextState.kind === "received" ||
      nextState.kind === "waitlisted" ||
      nextState.kind === "full" ||
      nextState.kind === "closed"
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

  if (showConfirmation && confirmedState?.kind === "received") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>¡FELICIDADES!</h2>
        <p className="reservation-success-lead">
          Completaste el formulario. Te confirmaremos por Instagram para saber si estás en la lista.
        </p>
        <p className="reservation-success-details">
          {formatPartySize(confirmedState.partySize)} · {formattedDate}
        </p>
        <InstagramLastStep username={instagramUsername} linkCode={confirmedState.linkCode} />
      </section>
    );
  }

  if (showConfirmation && confirmedState?.kind === "waitlisted") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>ESTÁS EN LA COLA</h2>
        <p className="reservation-success-lead">
          Completaste el formulario, pero el cupo ya se llenó. Quedaste en la posición #
          {confirmedState.position} de la cola.
        </p>
        <p>Si se libera un lugar te escribiremos por Instagram.</p>
        <p>Revisa también tus solicitudes de mensajes en Instagram.</p>
        <p className="reservation-success-details">
          {formatPartySize(confirmedState.partySize)} · {formattedDate}
        </p>
        <InstagramLastStep username={instagramUsername} linkCode={confirmedState.linkCode} />
      </section>
    );
  }

  if (
    showConfirmation &&
    confirmedState?.kind === "full" &&
    confirmedState.reason === "full-rejected"
  ) {
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

  if (showConfirmation && confirmedState?.kind === "closed") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>EL CLAN SE CERRÓ</h2>
        <p className="reservation-success-lead">
          Las solicitudes se cerraron mientras llenabas el formulario.
        </p>
        <p>Mantente atento a la próxima apertura del clan.</p>
      </section>
    );
  }

  if (
    showConfirmation &&
    confirmedState?.kind === "full" &&
    confirmedState.reason === "event-full"
  ) {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>SIN LUGARES DISPONIBLES</h2>
        <p className="reservation-success-lead">
          Los lugares y la cola se llenaron mientras llenabas el formulario.
        </p>
        <p>Mantente atento a la próxima apertura del clan.</p>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => event.preventDefault()} className="reservation-form" noValidate>
      {canChoosePartySize ? (
        <div className="reservation-section">
          <h2 className="reservation-section-heading">Quiénes van</h2>
          <fieldset className="reservation-party">
            <legend id="partySize-legend" className="reservation-label">
              ¿Cuántas personas?
            </legend>
            <Controller
              control={control}
              name="partySize"
              render={({ field }) => (
                <SegmentedControl
                  ref={field.ref}
                  className="reservation-choice"
                  value={field.value ? String(field.value) : ""}
                  onValueChange={(value) => choosePartySize(value, field.onChange)}
                  onBlur={field.onBlur}
                  required
                  aria-labelledby="partySize-legend"
                  aria-invalid={Boolean(errors.partySize)}
                  aria-describedby={errors.partySize ? "partySize-error" : undefined}
                >
                  <SegmentedControlItem className="reservation-choice-item" value="1">
                    Solo
                  </SegmentedControlItem>
                  <SegmentedControlItem className="reservation-choice-item" value="2">
                    En pareja
                  </SegmentedControlItem>
                </SegmentedControl>
              )}
            />
            <FieldError id="partySize-error" message={errors.partySize?.message} />
          </fieldset>
        </div>
      ) : null}

      <div role="group" aria-labelledby="guest1-heading" className="reservation-section">
        <h2 id="guest1-heading" className="reservation-section-heading">
          <span key={isCouple ? "couple" : "solo"} className="reservation-heading-swap">
            {isCouple ? "Invitado 1" : "Tus datos"}
          </span>
        </h2>

        <div className="reservation-guest-fields">
          <div className="reservation-field">
            <label htmlFor="guest1Name" className="reservation-label">
              Nombre completo
            </label>
            <input
              id="guest1Name"
              autoComplete="name"
              className={inputClassName}
              aria-invalid={Boolean(errors.guest1Name)}
              {...register("guest1Name")}
            />
            <FieldError message={errors.guest1Name?.message} />
          </div>

          <div className="reservation-field">
            <label htmlFor="guest1Instagram" className="reservation-label">
              Usuario de Instagram
            </label>
            <input
              id="guest1Instagram"
              autoComplete="off"
              className={inputClassName}
              aria-invalid={Boolean(errors.guest1Instagram)}
              {...register("guest1Instagram")}
            />
            <FieldError message={errors.guest1Instagram?.message} />
          </div>
        </div>
      </div>

      {secondGuest.isRendered ? (
        <div
          key={secondGuest.epoch}
          className="reservation-collapse"
          data-open={secondGuest.isExpanded}
        >
          <div className="reservation-collapse-inner" inert={!isCouple}>
            <div
              role="group"
              aria-labelledby="guest2-heading"
              aria-hidden={isCouple ? undefined : true}
              className="reservation-section"
            >
              <h2 id="guest2-heading" className="reservation-section-heading">
                Invitado 2
              </h2>

              <div className="reservation-guest-fields">
                <div className="reservation-field">
                  <label htmlFor="guest2Name" className="reservation-label">
                    Nombre completo
                  </label>
                  <input
                    id="guest2Name"
                    autoComplete="off"
                    className={inputClassName}
                    readOnly={!isCouple}
                    aria-invalid={Boolean(isCouple && errors.guest2Name)}
                    {...(isCouple ? register("guest2Name") : {})}
                  />
                  <FieldError message={isCouple ? errors.guest2Name?.message : undefined} />
                </div>

                <div className="reservation-field">
                  <label htmlFor="guest2Instagram" className="reservation-label">
                    Usuario de Instagram
                  </label>
                  <input
                    id="guest2Instagram"
                    autoComplete="off"
                    className={inputClassName}
                    readOnly={!isCouple}
                    aria-invalid={Boolean(isCouple && errors.guest2Instagram)}
                    {...(isCouple ? register("guest2Instagram") : {})}
                  />
                  <FieldError message={isCouple ? errors.guest2Instagram?.message : undefined} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="reservation-section">
        <h2 className="reservation-section-heading">Alergias</h2>

        <fieldset
          className="reservation-allergies"
          role="radiogroup"
          aria-invalid={Boolean(errors.hasAllergies)}
          aria-describedby={errors.hasAllergies ? "hasAllergies-error" : undefined}
        >
          <legend className="reservation-label">
            {isCouple ? "¿Alguno de los dos tiene alergias?" : "¿Tienes alergias?"}
          </legend>
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
          <div className="reservation-field">
            <label htmlFor="allergies" className="reservation-label">
              {isCouple ? "¿Quién y a qué?" : "¿A qué?"}
            </label>
            <textarea
              id="allergies"
              rows={3}
              maxLength={300}
              className={inputClassName}
              aria-invalid={Boolean(errors.allergies)}
              aria-describedby={allergiesDescription(isCouple, Boolean(errors.allergies))}
              {...register("allergies")}
            />
            {isCouple ? (
              <p id="allergies-help" className="reservation-help">
                Indica de quién es cada alergia.
              </p>
            ) : null}
            <FieldError id="allergies-error" message={errors.allergies?.message} />
          </div>
        ) : null}
      </div>

      <div className="reservation-section">
        <div className="reservation-field">
          <label htmlFor="notes" className="reservation-label">
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
      </div>

      <div className="reservation-section">
        <h2 className="reservation-section-heading">Confirmación</h2>

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
              <Link href="/privacidad">política de privacidad</Link>, incluido el uso de mi
              información de alergias solo para preparar la experiencia.
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
            options={{
              action: "reserve",
              cData: idempotencyKey,
              refreshExpired: "auto",
              theme: "light",
            }}
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
            handleColor={LIGHT_PAGE_INK}
            successColor={LIGHT_PAGE_INK}
            dangerColor={LIGHT_PAGE_ERROR}
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
      </div>
    </form>
  );
}
