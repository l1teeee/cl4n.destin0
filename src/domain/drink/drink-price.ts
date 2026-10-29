export const MAX_DRINK_PRICE_CENTS = 999_999;

export function parseDrinkPriceCents(text: string): number | null {
  const value = text.trim();
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(value)) return null;

  const [whole, fraction = ""] = value.split(/[.,]/);
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatDrinkPrice(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return new Intl.NumberFormat("es-SV", {
    style: "currency",
    currency: "USD",
  })
    .formatToParts(whole)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
}

export function drinkPriceInputValue(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}
