import { z } from "zod";

import { parseDrinkPriceCents } from "@/domain/drink/drink-price";

export const MAX_DRINK_NAME_LENGTH = 80;
export const MAX_DRINK_DESCRIPTION_LENGTH = 280;

export function readDrinkFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    description: formData.get("description"),
    price: formData.get("price"),
    isVisible: formData.get("isVisible") === "on",
  };
}

const priceSchema = z
  .string()
  .superRefine((value, context) => {
    const cents = parseDrinkPriceCents(value);
    if (cents === null) {
      context.addIssue({
        code: "custom",
        message: "Escribe el precio con números, por ejemplo 4.50.",
      });
    } else if (cents === 0) {
      context.addIssue({ code: "custom", message: "El precio debe ser mayor que cero." });
    }
  })
  .transform((value) => parseDrinkPriceCents(value)!);

export const drinkFormSchema = z
  .object({
    name: z
      .string({ error: "El nombre es obligatorio." })
      .trim()
      .min(1, "El nombre es obligatorio.")
      .max(MAX_DRINK_NAME_LENGTH, "El nombre no puede superar 80 caracteres."),
    description: z
      .string()
      .transform((value) => value.trim() || null)
      .refine(
        (value) => value === null || value.length <= MAX_DRINK_DESCRIPTION_LENGTH,
        "La descripción no puede superar 280 caracteres.",
      ),
    price: priceSchema,
    isVisible: z.boolean(),
  })
  .strict()
  .transform(({ price, ...input }) => ({ ...input, priceCents: price }));

export type DrinkFormInput = z.output<typeof drinkFormSchema>;
