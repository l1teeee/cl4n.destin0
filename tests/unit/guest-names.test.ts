import { describe, expect, it } from "vitest";

import { firstName, guestFirstNames } from "@/domain/reservation/guest-names";

describe("guest names", () => {
  it("returns the first trimmed whitespace-separated word", () => {
    expect(firstName("  Ana   María López ")).toBe("Ana");
    expect(firstName("Luis\tAlberto")).toBe("Luis");
  });

  it("formats one guest or a couple", () => {
    expect(guestFirstNames("Ana López", null)).toBe("Ana");
    expect(guestFirstNames("Ana López", "Luis Pérez")).toBe("Ana y Luis");
  });
});
