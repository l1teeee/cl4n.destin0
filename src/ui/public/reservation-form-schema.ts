import { z } from "zod";

import { guestRequestBaseSchema, requiredInstagram, requiredName } from "@/contracts/guest-request";
import { normalizeInstagram } from "@/domain/reservation/contact-normalization";
import { hasDuplicateHandles, MAX_PARTY_SIZE } from "@/domain/reservation/request-guests";
import { publicMessages, type PublicMessages } from "./i18n/messages";

// The form resolver reports the first branch of a union, as "Invalid input: expected 1", instead of
// the message of the contract's partySize union. One number rule with the same message
// puts the sentence the guest should read on the field.
const partySizeChoice = z
  .number({ error: publicMessages.es.reservation.validation.partyChoice })
  .int(publicMessages.es.reservation.validation.partyChoice)
  .min(1, publicMessages.es.reservation.validation.partyChoice);

const additionalGuestSchema = z.object({
  name: requiredName,
  instagram: requiredInstagram,
});

const reservationFormBaseSchema = guestRequestBaseSchema
  .omit({ eventSlug: true, turnstileToken: true, guests: true })
  .extend({
    partySize: partySizeChoice,
    guest1Name: requiredName,
    guest1Instagram: requiredInstagram,
    guest2Name: requiredName.optional(),
    guest2Instagram: requiredInstagram.optional(),
    additionalGuests: z
      .array(additionalGuestSchema)
      .max(MAX_PARTY_SIZE - 1)
      .optional(),
  });

export function translateReservationValidation(
  message: string,
  messages: PublicMessages["reservation"],
): string {
  const source = publicMessages.es.reservation.validation;
  for (const key of Object.keys(source) as Array<keyof typeof source>) {
    if (source[key] === message) {
      return messages.validation[key];
    }
  }
  if (message === publicMessages.es.reservation.errors.partySize) {
    return messages.errors.partySize;
  }
  return messages.errors.validation;
}

export function reservationFormSchema(
  maxPartySize: number,
  messages: PublicMessages["reservation"] = publicMessages.es.reservation,
) {
  const isGroupEvent = maxPartySize >= 3;
  const schema = reservationFormBaseSchema.superRefine((input, context) => {
    if (isGroupEvent) {
      for (const field of ["guest2Name", "guest2Instagram"] as const) {
        if (input[field] !== undefined) {
          context.addIssue({
            code: "custom",
            message: "Quita los datos del invitado 2 o elige pareja.",
            path: [field],
          });
        }
      }

      const additionalGuests = input.additionalGuests ?? [];
      const expectedAdditional = Math.max(0, Math.min(input.partySize, MAX_PARTY_SIZE) - 1);
      for (let index = additionalGuests.length; index < expectedAdditional; index += 1) {
        context.addIssue({
          code: "custom",
          message: "El nombre completo es obligatorio.",
          path: ["additionalGuests", index, "name"],
        });
        context.addIssue({
          code: "custom",
          message: "El usuario de Instagram es obligatorio.",
          path: ["additionalGuests", index, "instagram"],
        });
      }
      for (let index = expectedAdditional; index < additionalGuests.length; index += 1) {
        context.addIssue({
          code: "custom",
          message: publicMessages.es.reservation.errors.partySize,
          path: ["additionalGuests", index, "name"],
        });
      }

      const seenHandles = new Set<string>();
      const firstHandle = normalizeInstagram(input.guest1Instagram);
      if (firstHandle.ok) {
        seenHandles.add(firstHandle.value);
      }
      for (const [index, guest] of additionalGuests.entries()) {
        const handle = normalizeInstagram(guest.instagram);
        if (!handle.ok) continue;
        if (seenHandles.has(handle.value)) {
          context.addIssue({
            code: "custom",
            message: "Cada invitado necesita su propio usuario de Instagram.",
            path: ["additionalGuests", index, "instagram"],
          });
        }
        seenHandles.add(handle.value);
      }
    } else {
      if (input.partySize === 2) {
        if (!input.guest2Name) {
          context.addIssue({
            code: "custom",
            message: "El nombre del invitado 2 es obligatorio.",
            path: ["guest2Name"],
          });
        }
        if (!input.guest2Instagram) {
          context.addIssue({
            code: "custom",
            message: "El usuario de Instagram del invitado 2 es obligatorio.",
            path: ["guest2Instagram"],
          });
        }
      } else {
        for (const field of ["guest2Name", "guest2Instagram"] as const) {
          if (input[field] !== undefined) {
            context.addIssue({
              code: "custom",
              message: "Quita los datos del invitado 2 o elige pareja.",
              path: [field],
            });
          }
        }
      }
      if (input.additionalGuests && input.additionalGuests.length > 0) {
        context.addIssue({
          code: "custom",
          message: publicMessages.es.reservation.errors.partySize,
          path: ["partySize"],
        });
      }
      if (
        input.guest2Instagram &&
        hasDuplicateHandles([input.guest1Instagram, input.guest2Instagram])
      ) {
        context.addIssue({
          code: "custom",
          message: "Cada invitado necesita su propio usuario de Instagram.",
          path: ["guest2Instagram"],
        });
      }
    }

    if (input.hasAllergies && !input.allergies) {
      context.addIssue({
        code: "custom",
        message:
          input.partySize > 1
            ? "Cuéntanos quién y a qué es alérgico."
            : "Cuéntanos a qué eres alérgico.",
        path: ["allergies"],
      });
    }

    if (input.partySize > maxPartySize) {
      context.addIssue({
        code: "custom",
        message: publicMessages.es.reservation.errors.partySize,
        path: ["partySize"],
      });
    }
  });

  // Translate explicit contract messages without changing the shared server schema or its rules.
  return z.custom<ReservationFormInput>().transform((input, context) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) {
        context.addIssue({
          ...issue,
          message: translateReservationValidation(issue.message, messages),
        });
      }
      return z.NEVER;
    }
    return result.data;
  });
}

export type ReservationFormInput = z.input<typeof reservationFormBaseSchema>;
export type ReservationFormValues = z.output<typeof reservationFormBaseSchema>;
