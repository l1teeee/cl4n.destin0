import { describe, expect, it } from "vitest";

import { drinkFormSchema, readDrinkFormData } from "@/contracts/admin-drink";

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: "Copa de vino",
    description: "Vino de la casa",
    price: "4.50",
    isVisible: true,
    ...overrides,
  };
}

describe("admin drink contract", () => {
  it("normalizes valid fields", () => {
    expect(drinkFormSchema.parse(input({ name: "  Vino  ", description: "   " }))).toEqual({
      name: "Vino",
      description: null,
      priceCents: 450,
      isVisible: true,
    });
  });

  it.each([
    ["name", "", "El nombre es obligatorio."],
    ["name", "a".repeat(81), "El nombre no puede superar 80 caracteres."],
    ["description", "a".repeat(281), "La descripción no puede superar 280 caracteres."],
    ["price", "abc", "Escribe el precio con números, por ejemplo 4.50."],
    ["price", "0", "El precio debe ser mayor que cero."],
  ])("reports the %s error", (field, value, message) => {
    const result = drinkFormSchema.safeParse(input({ [field]: value }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({ path: [field], message });
    }
  });

  it("reads visibility from the checkbox", () => {
    const formData = new FormData();
    formData.set("name", "Vino");
    formData.set("description", "");
    formData.set("price", "4.50");
    formData.set("isVisible", "on");
    expect(readDrinkFormData(formData)).toEqual({
      name: "Vino",
      description: "",
      price: "4.50",
      isVisible: true,
    });
  });

  it("reads an unchecked visibility switch as hidden", () => {
    const formData = new FormData();
    formData.set("name", "Vino");
    formData.set("description", "");
    formData.set("price", "4.50");
    expect(readDrinkFormData(formData)).toMatchObject({ isVisible: false });
  });
});
