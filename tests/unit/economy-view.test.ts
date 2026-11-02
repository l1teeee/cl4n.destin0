import { describe, expect, it } from "vitest";

import type { EconomyGuest } from "@/application/economy/economy-repository";
import {
  economySummary,
  filterGuests,
  guestHeading,
  itemButtonLabel,
  stageLabel,
} from "@/ui/admin/economy/economy-view";

function guest(overrides: Partial<EconomyGuest> = {}): EconomyGuest {
  return {
    reservationId: "11111111-1111-4111-8111-111111111111",
    reservationNumber: 7,
    slot: 1,
    fullName: "Ana López",
    instagram: "ana.lopez",
    stage: "ON_LIST",
    totalCents: 0,
    settled: false,
    settledAt: null,
    lines: [],
    ...overrides,
  };
}

const guests = [
  guest(),
  guest({ slot: 2, fullName: "José Pérez", instagram: "jose.p", settled: true }),
  guest({ reservationNumber: 8, fullName: "Marta", instagram: null }),
];

describe("economy view helpers", () => {
  it("filters by tab state", () => {
    expect(filterGuests(guests, "ALL", "")).toHaveLength(3);
    expect(filterGuests(guests, "PENDING", "").map((item) => item.fullName)).toEqual([
      "Ana López",
      "Marta",
    ]);
    expect(filterGuests(guests, "PAID", "").map((item) => item.fullName)).toEqual(["José Pérez"]);
  });

  it("searches by name or Instagram ignoring case, accents and the at sign", () => {
    expect(filterGuests(guests, "ALL", "jose").map((item) => item.fullName)).toEqual([
      "José Pérez",
    ]);
    expect(filterGuests(guests, "ALL", "@ANA.lo").map((item) => item.fullName)).toEqual([
      "Ana López",
    ]);
    expect(filterGuests(guests, "ALL", "nadie")).toEqual([]);
  });

  it("combines the search with the tab state", () => {
    expect(filterGuests(guests, "PAID", "ana")).toEqual([]);
  });

  it("summarizes guests and paid tabs", () => {
    expect(economySummary(guests)).toBe("3 invitados · 1 pagado");
    expect(economySummary([guest()])).toBe("1 invitado · 0 pagados");
  });

  it("builds the guest heading with the number, name and Instagram", () => {
    expect(guestHeading(guest())).toBe("#007 · Ana López · @ana.lopez");
    expect(guestHeading(guest({ instagram: null }))).toBe("#007 · Ana López");
  });

  it("labels stages and catalog buttons", () => {
    expect(stageLabel("ON_LIST")).toBe("En la lista");
    expect(stageLabel("PAID")).toBe("Confirmado");
    expect(itemButtonLabel({ name: "Vino", priceCents: 450 })).toContain("Vino · ");
  });
});
