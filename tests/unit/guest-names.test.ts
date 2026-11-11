import { describe, expect, it } from "vitest";

import { firstName } from "@/domain/reservation/guest-names";
import { guestFirstNames, hasDuplicateHandles } from "@/domain/reservation/request-guests";

describe("guest names", () => {
  it("returns the first trimmed whitespace-separated word", () => {
    expect(firstName("  Ana   María López ")).toBe("Ana");
    expect(firstName("Luis\tAlberto")).toBe("Luis");
  });

  it("formats one guest or a couple", () => {
    expect(guestFirstNames(["Ana López"])).toBe("Ana");
    expect(guestFirstNames(["Ana López", "Luis Pérez"])).toBe("Ana y Luis");
    expect(guestFirstNames(["Ana López", "Luis Pérez", "Marta García"])).toBe("Ana, Luis y Marta");
  });

  it("detects duplicate normalized handles anywhere in a group", () => {
    expect(hasDuplicateHandles(["ana", "luis", "https://instagram.com/ANA/"])).toBe(true);
    expect(hasDuplicateHandles(["ana", "luis", "marta"])).toBe(false);
  });
});
