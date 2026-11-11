import { describe, expect, it } from "vitest";

import { consumptionFormSchema, guestSlotSchema } from "@/contracts/admin-economy";
import { extraFormSchema } from "@/contracts/admin-extra";
import {
  isValidItemName,
  isValidQuantity,
  isValidUnitPriceCents,
  lineTotalCents,
} from "@/domain/economy/consumption";

const itemId = "6f1a4c1e-5f6b-4a4e-9d57-0d1a5f0f9a11";

describe("consumption rules", () => {
  it("multiplies the unit price by the quantity in integer cents", () => {
    expect(lineTotalCents(450, 3)).toBe(1350);
    expect(lineTotalCents(0, 5)).toBe(0);
  });

  it("accepts only whole quantities from 1 to 99", () => {
    expect([0, 100, 1.5, -1, Number.NaN].some(isValidQuantity)).toBe(false);
    expect([1, 50, 99].every(isValidQuantity)).toBe(true);
  });

  it("accepts only whole non-negative prices up to 10,000,000 cents", () => {
    expect([-1, 1.5, 10_000_001, Number.NaN].some(isValidUnitPriceCents)).toBe(false);
    expect([0, 1, 10_000_000].every(isValidUnitPriceCents)).toBe(true);
  });

  it("accepts names from 1 to 80 characters", () => {
    expect(isValidItemName("")).toBe(false);
    expect(isValidItemName("x".repeat(81))).toBe(false);
    expect(isValidItemName("x".repeat(80))).toBe(true);
  });
});

describe("consumption form contract", () => {
  it("parses a catalog line", () => {
    expect(consumptionFormSchema.parse({ source: "DRINK", itemId, quantity: "2" })).toEqual({
      source: "DRINK",
      itemId,
      quantity: 2,
    });
  });

  it("parses a custom line into cents", () => {
    expect(
      consumptionFormSchema.parse({
        source: "CUSTOM",
        customName: "  Postre  ",
        customPrice: "4,50",
        quantity: "1",
      }),
    ).toEqual({ source: "CUSTOM", customName: "Postre", customPriceCents: 450, quantity: 1 });
  });

  it("rejects bad quantities, prices and unknown sources", () => {
    const custom = { source: "CUSTOM", customName: "Agua", customPrice: "1.00" };

    expect(consumptionFormSchema.safeParse({ ...custom, quantity: "0" }).success).toBe(false);
    expect(consumptionFormSchema.safeParse({ ...custom, quantity: "100" }).success).toBe(false);
    expect(consumptionFormSchema.safeParse({ ...custom, quantity: "1.5" }).success).toBe(false);
    expect(
      consumptionFormSchema.safeParse({ ...custom, customPrice: "-1", quantity: "1" }).success,
    ).toBe(false);
    expect(
      consumptionFormSchema.safeParse({ source: "OTHER", itemId, quantity: "1" }).success,
    ).toBe(false);
    expect(
      consumptionFormSchema.safeParse({ source: "EXTRA", itemId: "no-es-uuid", quantity: "1" })
        .success,
    ).toBe(false);
  });

  it("allows guest slots 1 to MAX_PARTY_SIZE", () => {
    expect(guestSlotSchema.safeParse(1).success).toBe(true);
    expect(guestSlotSchema.safeParse(2).success).toBe(true);
    expect(guestSlotSchema.safeParse(3).success).toBe(true);
    expect(guestSlotSchema.safeParse(100).success).toBe(true);
    expect(guestSlotSchema.safeParse(0).success).toBe(false);
    expect(guestSlotSchema.safeParse(101).success).toBe(false);
    expect(guestSlotSchema.safeParse(1.5).success).toBe(false);
  });
});

describe("extra form contract", () => {
  it("parses the price into cents and defaults the order to zero", () => {
    expect(
      extraFormSchema.parse({ name: " Pan ", price: "3", sortOrder: "", isActive: true }),
    ).toEqual({ name: "Pan", sortOrder: 0, isActive: true, priceCents: 300 });
  });

  it("allows a free extra but rejects invalid prices and names", () => {
    const valid = { name: "Pan", price: "0", sortOrder: "1", isActive: true };

    expect(extraFormSchema.safeParse(valid).success).toBe(true);
    expect(extraFormSchema.safeParse({ ...valid, price: "-1" }).success).toBe(false);
    expect(extraFormSchema.safeParse({ ...valid, price: "abc" }).success).toBe(false);
    expect(extraFormSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(extraFormSchema.safeParse({ ...valid, sortOrder: "-2" }).success).toBe(false);
  });
});
