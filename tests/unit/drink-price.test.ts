import { describe, expect, it } from "vitest";

import {
  drinkPriceInputValue,
  formatDrinkPrice,
  parseDrinkPriceCents,
} from "@/domain/drink/drink-price";

describe("drink prices", () => {
  it.each([
    ["4", 400],
    ["4.5", 450],
    ["4.50", 450],
    ["4,50", 450],
    ["0.05", 5],
    ["9999.99", 999_999],
    [" 4.50 ", 450],
  ])("parses %s", (input, expected) => {
    expect(parseDrinkPriceCents(input)).toBe(expected);
  });

  it.each(["", "abc", "-1", "4.505", "10000", "1e3", "4."])("rejects %s", (input) => {
    expect(parseDrinkPriceCents(input)).toBeNull();
  });

  it.each([
    [450, "$4.50"],
    [123_450, "$1,234.50"],
  ])("formats %d cents", (input, expected) => {
    expect(formatDrinkPrice(input)).toBe(expected);
  });

  it.each([
    [450, "4.50"],
    [5, "0.05"],
    [100_000, "1000.00"],
  ])("builds the input value for %d cents", (input, expected) => {
    expect(drinkPriceInputValue(input)).toBe(expected);
  });
});
