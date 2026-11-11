"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";

import { Button } from "@/ui/primitives/button";
import { SegmentedControl, SegmentedControlItem } from "@/ui/primitives/segmented-control";
import SlideCommit from "@/ui/primitives/slide-commit";
import { FieldError, GroupGuestFields } from "./group-guest-fields";
import type { PublicLocale, PublicMessages } from "./i18n/messages";
import { configuredInstagramUsername } from "./instagram-profile";

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

export { FieldError };

interface ReservationFormProps {
  eventSlug: string;
  maxPartySize: number;
  formattedDate: string;
  locale?: PublicLocale;
  messages: PublicMessages["reservation"];
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

function formatPartySize(partySize: number, messages: PublicMessages["reservation"]): string {
  return `${partySize} ${partySize === 1 ? messages.person : messages.people}`;
}

function submittedGuestNames(fields: ReservationFormValues): string[] {
  if (fields.additionalGuests && fields.additionalGuests.length > 0) {
    return [
      fields.guest1Name,
      ...fields.additionalGuests.slice(0, fields.partySize - 1).map((guest) => guest.name),
    ];
  }
  if (fields.partySize === 2 && fields.guest2Name) {
    return [fields.guest1Name, fields.guest2Name];
  }
  return [fields.guest1Name];
}

function formatGuestNames(names: string[], messages: PublicMessages["reservation"]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${messages.nameConjunction} ${names[names.length - 1]}`;
}

function allergiesDescription(hasMultipleGuests: boolean, hasError: boolean): string | undefined {
  const ids: string[] = [];
  if (hasMultipleGuests) ids.push("allergies-help");
  if (hasError) ids.push("allergies-error");
  return ids.length > 0 ? ids.join(" ") : undefined;
}

const serverGuestFieldPattern = /^guests\.(\d+)\.(name|instagram)$/;

function formErrorPath(
  field: ReservationFormField,
  isGroupEvent: boolean,
): FieldPath<ReservationFormInput> {
  if (isGroupEvent) {
    if (field === "guest2Name") return "additionalGuests.0.name";
    if (field === "guest2Instagram") return "additionalGuests.0.instagram";
    const match = serverGuestFieldPattern.exec(field);
    if (match) {
      const guestIndex = Number(match[1]);
      const property = match[2] as "name" | "instagram";
      if (guestIndex === 0) {
        return property === "name" ? "guest1Name" : "guest1Instagram";
      }
      return `additionalGuests.${guestIndex - 1}.${property}`;
    }
  }
  return field as FieldPath<ReservationFormInput>;
}

function visualOrderFields(
  isGroupEvent: boolean,
  additionalCount: number,
): FieldPath<ReservationFormInput>[] {
  if (!isGroupEvent) {
    return [...reservationFormFields];
  }
  const dynamicGuestFields: FieldPath<ReservationFormInput>[] = [];
  for (let index = 0; index < additionalCount; index += 1) {
    dynamicGuestFields.push(
      `additionalGuests.${index}.name`,
      `additionalGuests.${index}.instagram`,
    );
  }
  return [
    "partySize",
    "guest1Name",
    "guest1Instagram",
    ...dynamicGuestFields,
    "hasAllergies",
    "allergies",
    "notes",
    "acceptTerms",
  ];
}

function InstagramLastStep({
  username,
  linkCode,
  messages,
}: {
  username: string | undefined;
  linkCode: string;
  messages: PublicMessages["reservation"];
}) {
  return (
    <div className="reservation-last-step">
      <h3>{messages.lastStep}</h3>
      {username ? (
        <>
          <p>{messages.instagramPrompt.replace("{username}", username)}</p>
          <Button asChild>
            <a
              href={`https://ig.me/m/${encodeURIComponent(username)}?ref=${encodeURIComponent(linkCode)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {messages.openChat}
            </a>
          </Button>
        </>
      ) : null}
      <div className="reservation-link-code">
        <p>
          {messages.yourCode} <code>{linkCode}</code>
        </p>
        <p className="reservation-help">{username ? messages.desktopCode : messages.directCode}</p>
        <p className="reservation-help">{messages.messageRequestsHelp}</p>
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
  locale = "es",
  messages,
  nonce,
}: ReservationFormProps) {
  const turnstileRef = useRef<TurnstileInstance>(null);
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [formState, setFormState] = useState<ReservationFormState | null>(null);
  const [confirmedState, setConfirmedState] = useState<ConfirmedReservationState | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submittedNames, setSubmittedNames] = useState<string[]>([]);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const instagramUsername = configuredInstagramUsername();
  const isGroupEvent = maxPartySize >= 3;
  const canChoosePartySize = maxPartySize >= 2;
  const {
    register,
    handleSubmit,
    clearErrors,
    getFieldState,
    getValues,
    setError,
    setFocus,
    setValue,
    trigger,
    unregister,
    control,
    formState: { errors, isSubmitting, isValid },
  } = useForm<ReservationFormInput, unknown, ReservationFormValues>({
    resolver: zodResolver(reservationFormSchema(maxPartySize, messages)),
    defaultValues: {
      partySize: 1,
      ...(isGroupEvent ? { additionalGuests: [] } : {}),
    },
    mode: "onTouched",
  });
  const {
    fields: guestFields,
    append,
    remove,
  } = useFieldArray({
    control,
    name: "additionalGuests",
  });
  const partySize = useWatch({ control, name: "partySize" });
  const hasAllergies = useWatch({ control, name: "hasAllergies" });
  const currentPartySize = partySize ?? 1;
  const isCouple = !isGroupEvent && currentPartySize === 2;
  const hasMultipleGuests = currentPartySize > 1;
  const secondGuest = useSecondGuestTransition(isCouple);

  function choosePartySize(value: string, onChange: (partySize: number) => void) {
    if (value === "2" && secondGuest.isCollapsing) {
      secondGuest.restartCollapsingBlock();
    }
    onChange(Number(value));
  }

  function incrementPartySize() {
    const current = getValues("partySize") ?? 1;
    if (current >= maxPartySize) return;
    const next = current + 1;
    clearErrors("partySize");
    setValue("partySize", next, { shouldDirty: true });
    append({ name: "", instagram: "" }, { shouldFocus: false });
  }

  function decrementPartySize() {
    const current = getValues("partySize") ?? 1;
    if (current <= 1) return;
    const next = current - 1;
    clearErrors("partySize");
    setValue("partySize", next, { shouldDirty: true });
    remove(next - 1);
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
    if (!isGroupEvent && partySize === 1) {
      unregister(["guest2Name", "guest2Instagram"]);
    }
  }, [isGroupEvent, partySize, unregister]);

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
    clearErrors();
    if (nextState.kind === "error") {
      for (const [field, fieldMessages] of Object.entries(nextState.fieldErrors)) {
        const message = fieldMessages?.[0];
        if (message) {
          setError(formErrorPath(field as ReservationFormField, isGroupEvent), {
            type: "server",
            message,
          });
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
    const {
      guest1Name,
      guest1Instagram,
      guest2Name,
      guest2Instagram,
      additionalGuests,
      partySize,
      allergies,
      ...requestFields
    } = fields;
    const guests = [{ name: guest1Name, instagram: guest1Instagram }];
    if (isGroupEvent) {
      for (const guest of (additionalGuests ?? []).slice(0, partySize - 1)) {
        guests.push({ name: guest.name, instagram: guest.instagram });
      }
    } else if (partySize === 2) {
      guests.push({ name: guest2Name!, instagram: guest2Instagram! });
    }
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
          guests,
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
        message: messages.connectionError,
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
    const nextState = toFormState(
      {
        status: response.status,
        body,
        ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? { retryAfterSeconds }
          : {}),
      },
      locale,
      messages,
    );

    if (
      nextState.kind === "received" ||
      nextState.kind === "waitlisted" ||
      nextState.kind === "full" ||
      nextState.kind === "closed"
    ) {
      setConfirmedState(nextState);
      setSubmittedNames(submittedGuestNames(fields));
    }

    if (nextState.kind === "error" && nextState.automaticRetry && !alreadyRetried) {
      setFormState({
        ...nextState,
        message: messages.retrying,
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

    const orderedFields = visualOrderFields(isGroupEvent, guestFields.length);
    const firstInvalidField = orderedFields.find((field) => getFieldState(field).invalid);
    if (firstInvalidField) setFocus(firstInvalidField);
  }

  function showConfirmationAfterDone() {
    clearTimeout(confirmationTimer.current);
    confirmationTimer.current = setTimeout(() => setShowConfirmation(true), 700);
  }

  if (showConfirmation && confirmedState?.kind === "received") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>{messages.receivedTitle}</h2>
        <p className="reservation-success-lead">{messages.receivedLead}</p>
        <p className="reservation-success-details">{formatGuestNames(submittedNames, messages)}</p>
        <p className="reservation-success-details">
          {formatPartySize(confirmedState.partySize, messages)} · {formattedDate}
        </p>
        <InstagramLastStep
          username={instagramUsername}
          linkCode={confirmedState.linkCode}
          messages={messages}
        />
      </section>
    );
  }

  if (showConfirmation && confirmedState?.kind === "waitlisted") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>{messages.waitlistedTitle}</h2>
        <p className="reservation-success-lead">
          {messages.waitlistedLead.replace("{position}", String(confirmedState.position))}
        </p>
        <p>{messages.waitlistedHelp}</p>
        <p>{messages.messageRequests}</p>
        <p className="reservation-success-details">{formatGuestNames(submittedNames, messages)}</p>
        <p className="reservation-success-details">
          {formatPartySize(confirmedState.partySize, messages)} · {formattedDate}
        </p>
        <InstagramLastStep
          username={instagramUsername}
          linkCode={confirmedState.linkCode}
          messages={messages}
        />
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
        <h2>{messages.fullTitle}</h2>
        <p className="reservation-success-lead">{messages.fullRejected}</p>
        <p>{messages.nextOpening}</p>
      </section>
    );
  }

  if (showConfirmation && confirmedState?.kind === "closed") {
    return (
      <section className="reservation-success" aria-live="polite">
        <h2>{messages.closedTitle}</h2>
        <p className="reservation-success-lead">{messages.closedLead}</p>
        <p>{messages.nextOpening}</p>
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
        <h2>{messages.fullTitle}</h2>
        <p className="reservation-success-lead">{messages.fullLead}</p>
        <p>{messages.nextOpening}</p>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => event.preventDefault()} className="reservation-form" noValidate>
      {isGroupEvent ? (
        <div className="reservation-section">
          <h2 className="reservation-section-heading">{messages.who}</h2>
          <fieldset className="reservation-party">
            <legend id="partySize-legend" className="reservation-label">
              {messages.groupPartySize}
            </legend>
            <div
              className="flex w-full items-center justify-between gap-4"
              aria-labelledby="partySize-legend"
              aria-describedby={
                errors.partySize ? "partySize-help partySize-error" : "partySize-help"
              }
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={messages.removePerson}
                disabled={currentPartySize <= 1}
                onClick={decrementPartySize}
              >
                -
              </Button>
              <output
                aria-live="polite"
                className="min-w-12 text-center text-lg font-semibold tabular-nums"
              >
                {currentPartySize}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="min-h-11 min-w-11"
                aria-label={messages.addPerson}
                disabled={currentPartySize >= maxPartySize}
                onClick={incrementPartySize}
              >
                +
              </Button>
            </div>
            <p id="partySize-help" className="reservation-help">
              {messages.partySizeHelp.replace("{max}", String(maxPartySize))}
            </p>
            <FieldError id="partySize-error" message={errors.partySize?.message} />
          </fieldset>
        </div>
      ) : canChoosePartySize ? (
        <div className="reservation-section">
          <h2 className="reservation-section-heading">{messages.who}</h2>
          <fieldset className="reservation-party">
            <legend id="partySize-legend" className="reservation-label">
              {messages.partySize}
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
                    {messages.solo}
                  </SegmentedControlItem>
                  <SegmentedControlItem className="reservation-choice-item" value="2">
                    {messages.couple}
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
            {isCouple ? messages.guest1 : messages.yourDetails}
          </span>
        </h2>

        <div className="reservation-guest-fields">
          <div className="reservation-field">
            <label htmlFor="guest1Name" className="reservation-label">
              {messages.fullName}
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
              {messages.instagram}
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

      {isGroupEvent ? (
        <GroupGuestFields
          fields={guestFields}
          register={register}
          errors={errors}
          messages={messages}
        />
      ) : secondGuest.isRendered ? (
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
                {messages.guest2}
              </h2>

              <div className="reservation-guest-fields">
                <div className="reservation-field">
                  <label htmlFor="guest2Name" className="reservation-label">
                    {messages.fullName}
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
                    {messages.instagram}
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
        <h2 className="reservation-section-heading">{messages.allergies}</h2>

        <fieldset
          className="reservation-allergies"
          role="radiogroup"
          aria-invalid={Boolean(errors.hasAllergies)}
          aria-describedby={errors.hasAllergies ? "hasAllergies-error" : undefined}
        >
          <legend className="reservation-label">
            {isGroupEvent
              ? hasMultipleGuests
                ? messages.groupAllergies
                : messages.soloAllergies
              : isCouple
                ? messages.coupleAllergies
                : messages.soloAllergies}
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
                  <span>{messages.no}</span>
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
                  <span>{messages.yes}</span>
                </label>
              </div>
            )}
          />
          <FieldError id="hasAllergies-error" message={errors.hasAllergies?.message} />
        </fieldset>

        {hasAllergies ? (
          <div className="reservation-field">
            <label htmlFor="allergies" className="reservation-label">
              {hasMultipleGuests ? messages.coupleAllergyDetail : messages.soloAllergyDetail}
            </label>
            <textarea
              id="allergies"
              rows={3}
              maxLength={300}
              className={inputClassName}
              aria-invalid={Boolean(errors.allergies)}
              aria-describedby={allergiesDescription(hasMultipleGuests, Boolean(errors.allergies))}
              {...register("allergies")}
            />
            {hasMultipleGuests ? (
              <p id="allergies-help" className="reservation-help">
                {messages.allergyHelp}
              </p>
            ) : null}
            <FieldError id="allergies-error" message={errors.allergies?.message} />
          </div>
        ) : null}
      </div>

      <div className="reservation-section">
        <div className="reservation-field">
          <label htmlFor="notes" className="reservation-label">
            {messages.notes}
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
        <h2 className="reservation-section-heading">{messages.confirmation}</h2>

        <div>
          <div className="reservation-terms">
            <input
              id="acceptTerms"
              type="checkbox"
              aria-invalid={Boolean(errors.acceptTerms)}
              {...register("acceptTerms")}
            />
            <label htmlFor="acceptTerms">
              {messages.acceptPrefix} <Link href="/terminos">{messages.terms}</Link>{" "}
              {messages.privacyJoin} <Link href="/privacidad">{messages.privacy}</Link>
              {messages.allergyConsent}
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
              language: locale,
            }}
            onSuccess={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
            onError={() => {
              setTurnstileToken(null);
              setFormState({
                kind: "error",
                message: messages.verificationError,
                fieldErrors: {},
                automaticRetry: false,
              });
            }}
          />
        ) : null}

        {!siteKey ? <p role="alert">{messages.verificationUnavailable}</p> : null}

        <div aria-live="polite" className="reservation-message">
          {formState?.kind === "error" ? <p>{formState.message}</p> : null}
        </div>

        <div className="reservation-slide" onClick={() => void showAllFieldErrors()}>
          <SlideCommit
            label={
              !isValid
                ? messages.completeForm
                : !turnstileToken || !idempotencyKey
                  ? messages.verifying
                  : messages.slideRequest
            }
            doneLabel={messages.sent}
            errorLabel={messages.notSent}
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
            {messages.slideHint}
          </p>
        </div>
      </div>
    </form>
  );
}
