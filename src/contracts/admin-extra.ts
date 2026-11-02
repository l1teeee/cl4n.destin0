import { z } from "zod";

import { MAX_ITEM_NAME_LENGTH } from "@/domain/economy/consumption";
import { parseDrinkPriceCents } from "@/domain/drink/drink-price";

export const MAX_EXTRA_SORT_ORDER = 9999;

// A price of zero is allowed: some extras (bread, cutlery) can be free.
export const priceInputSchema = z
  .string({ error: "Escribe el precio con números, por ejemplo 4.50." })
  .superRefine((value, context) => {
    if (parseDrinkPriceCents(value) === null) {
      context.addIssue({
        code: "custom",
        message: "Escribe el precio con números, por ejemplo 4.50.",
      });
    }
  })
  .transform((value) => parseDrinkPriceCents(value)!);

export const itemNameSchema = z
  .string({ error: "El nombre es obligatorio." })
  .trim()
  .min(1, "El nombre es obligatorio.")
  .max(MAX_ITEM_NAME_LENGTH, `El nombre no puede superar ${MAX_ITEM_NAME_LENGTH} caracteres.`);

const sortOrderSchema = z
  .string()
  .trim()
  .transform((value) => (value === "" ? 0 : Number(value)))
  .refine(
    (value) => Number.isInteger(value) && value >= 0 && value <= MAX_EXTRA_SORT_ORDER,
    `El orden debe ser un número entero entre 0 y ${MAX_EXTRA_SORT_ORDER}.`,
  );

export function readExtraFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    price: formData.get("price"),
    sortOrder: formData.get("sortOrder") ?? "",
    isActive: formData.get("isActive") === "on",
  };
}

export const extraFormSchema = z
  .object({
    name: itemNameSchema,
    price: priceInputSchema,
    sortOrder: sortOrderSchema,
    isActive: z.boolean(),
  })
  .strict()
  .transform(({ price, ...input }) => ({ ...input, priceCents: price }));

export const extraIdSchema = z.string().uuid("No se encontró el extra.");

export type ExtraFormInput = z.output<typeof extraFormSchema>;
