import { z } from "zod";

import { MAX_QUANTITY, MIN_QUANTITY } from "@/domain/economy/consumption";
import { MAX_PARTY_SIZE } from "@/domain/reservation/request-guests";

import { itemNameSchema, priceInputSchema } from "./admin-extra";

const idSchema = (message: string) => z.string().uuid(message);

export const economyEventIdSchema = idSchema("No se encontró la experiencia.");
export const economyReservationIdSchema = idSchema("No se encontró la reservación.");
export const economyConsumptionIdSchema = idSchema("No se encontró el consumo.");

export const guestSlotSchema = z
  .number({ error: "El invitado no es válido." })
  .int("El invitado no es válido.")
  .min(1, "El invitado no es válido.")
  .max(MAX_PARTY_SIZE, "El invitado no es válido.");

const quantitySchema = z
  .string({ error: "Indica la cantidad." })
  .trim()
  .transform(Number)
  .refine(
    (value) => Number.isInteger(value) && value >= MIN_QUANTITY && value <= MAX_QUANTITY,
    `La cantidad debe ser un número entero entre ${MIN_QUANTITY} y ${MAX_QUANTITY}.`,
  );

export function readConsumptionFormData(formData: FormData) {
  return {
    source: formData.get("source"),
    itemId: formData.get("itemId"),
    customName: formData.get("customName"),
    customPrice: formData.get("customPrice"),
    quantity: formData.get("quantity") ?? "1",
  };
}

const catalogItemSchema = z.object({
  source: z.enum(["DRINK", "EXTRA"]),
  itemId: z.string({ error: "Elige un producto." }).uuid("Elige un producto."),
  quantity: quantitySchema,
});

const customItemSchema = z.object({
  source: z.literal("CUSTOM"),
  customName: itemNameSchema,
  customPrice: priceInputSchema,
  quantity: quantitySchema,
});

export const consumptionFormSchema = z
  .discriminatedUnion("source", [catalogItemSchema, customItemSchema], {
    error: "Elige el tipo de consumo.",
  })
  .transform((input) =>
    input.source === "CUSTOM"
      ? {
          source: input.source,
          customName: input.customName,
          customPriceCents: input.customPrice,
          quantity: input.quantity,
        }
      : input,
  );

export type ConsumptionFormInput = z.output<typeof consumptionFormSchema>;
