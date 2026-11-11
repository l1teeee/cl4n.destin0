"use client";

import type { FieldArrayWithId, FieldErrors, UseFormRegister } from "react-hook-form";

import type { PublicMessages } from "./i18n/messages";
import type { ReservationFormInput } from "./reservation-form-schema";

const inputClassName = "reservation-input";

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

interface GroupGuestFieldsProps {
  fields: FieldArrayWithId<ReservationFormInput, "additionalGuests", "id">[];
  register: UseFormRegister<ReservationFormInput>;
  errors: FieldErrors<ReservationFormInput>;
  messages: PublicMessages["reservation"];
}

export function GroupGuestFields({ fields, register, errors, messages }: GroupGuestFieldsProps) {
  return (
    <>
      {fields.map((field, index) => {
        const guestNumber = index + 2;
        const headingId = `guest${guestNumber}-heading`;
        const nameId = `guest${guestNumber}Name`;
        const instagramId = `guest${guestNumber}Instagram`;
        const nameError = errors.additionalGuests?.[index]?.name?.message;
        const instagramError = errors.additionalGuests?.[index]?.instagram?.message;

        return (
          <div
            key={field.id}
            role="group"
            aria-labelledby={headingId}
            className="reservation-section animate-[public-fade_320ms_ease-out_backwards] motion-reduce:animate-none"
          >
            <h2 id={headingId} className="reservation-section-heading">
              {messages.groupGuest.replace("{number}", String(guestNumber))}
            </h2>

            <div className="reservation-guest-fields">
              <div className="reservation-field">
                <label htmlFor={nameId} className="reservation-label">
                  {messages.fullName}
                </label>
                <input
                  id={nameId}
                  autoComplete="off"
                  className={inputClassName}
                  aria-invalid={Boolean(nameError)}
                  {...register(`additionalGuests.${index}.name`)}
                />
                <FieldError message={nameError} />
              </div>

              <div className="reservation-field">
                <label htmlFor={instagramId} className="reservation-label">
                  {messages.instagram}
                </label>
                <input
                  id={instagramId}
                  autoComplete="off"
                  className={inputClassName}
                  aria-invalid={Boolean(instagramError)}
                  {...register(`additionalGuests.${index}.instagram`)}
                />
                <FieldError message={instagramError} />
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
