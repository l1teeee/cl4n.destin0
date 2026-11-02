import { z } from "zod";

import {
  ACCOUNT_TYPES,
  PAYMENT_FIELD_MAX_LENGTH,
  PAYMENT_LINK_MAX_LENGTH,
} from "@/domain/payment/payment-settings";

export function readPaymentSettingsFormData(formData: FormData) {
  return {
    bankName: formData.get("bankName"),
    accountType: formData.get("accountType"),
    accountNumber: formData.get("accountNumber"),
    accountHolder: formData.get("accountHolder"),
    paymentLink: formData.get("paymentLink"),
  };
}

function requiredText(requiredMessage: string, tooLongMessage: string) {
  return z
    .string({ error: requiredMessage })
    .trim()
    .min(1, requiredMessage)
    .max(PAYMENT_FIELD_MAX_LENGTH, tooLongMessage);
}

// The field takes a bank code as well as a link, but anything that looks like a web link must be secure.
function isSecureWhenLink(value: string): boolean {
  return !/^http/i.test(value) || /^https:\/\//i.test(value);
}

const paymentLink = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .trim()
    .max(PAYMENT_LINK_MAX_LENGTH, "El enlace o código no puede superar 300 caracteres.")
    .refine(isSecureWhenLink, "Si es un enlace, debe empezar con https://.")
    .nullable(),
);

export const paymentSettingsSchema = z
  .object({
    bankName: requiredText("El banco es obligatorio.", "El banco no puede superar 80 caracteres."),
    accountType: z.enum(ACCOUNT_TYPES, { error: "Elige Ahorro o Corriente." }),
    accountNumber: requiredText(
      "El número de cuenta es obligatorio.",
      "El número de cuenta no puede superar 80 caracteres.",
    ),
    accountHolder: requiredText(
      "El titular es obligatorio.",
      "El titular no puede superar 80 caracteres.",
    ),
    paymentLink,
  })
  .strict();

export type PaymentSettingsInput = z.output<typeof paymentSettingsSchema>;
