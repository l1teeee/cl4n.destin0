export const MAX_ITEM_NAME_LENGTH = 80;
export const MAX_UNIT_PRICE_CENTS = 10_000_000;
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 99;

export const CONSUMPTION_SOURCES = ["DRINK", "EXTRA", "CUSTOM"] as const;

export type GuestSlot = number;
export type ConsumptionSource = (typeof CONSUMPTION_SOURCES)[number];

export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  return unitPriceCents * quantity;
}

export function isValidItemName(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_ITEM_NAME_LENGTH;
}

export function isValidUnitPriceCents(cents: number): boolean {
  return Number.isInteger(cents) && cents >= 0 && cents <= MAX_UNIT_PRICE_CENTS;
}

export function isValidQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= MIN_QUANTITY && quantity <= MAX_QUANTITY;
}
