import { describe, expect, it } from "vitest";

import {
  extractLinkCode,
  isLinkCode,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
} from "@/domain/messaging/link-code";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";

describe("link codes", () => {
  it("accepts only six alphabet characters with at least two digits", () => {
    expect(LINK_CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    expect(LINK_CODE_LENGTH).toBe(6);
    expect(isLinkCode("AB23CD")).toBe(true);
    expect(isLinkCode("ABCDE2")).toBe(false);
    expect(isLinkCode("ABI23D")).toBe(false);
    expect(isLinkCode("ab23cd")).toBe(false);
    expect(isLinkCode("AB23CDE")).toBe(false);
  });

  it("extracts the first standalone valid token", () => {
    expect(extractLinkCode("hola ab23cd, luego XY45ZT")).toBe("AB23CD");
    expect(extractLinkCode("XAB23CD otro")).toBeNull();
    expect(extractLinkCode("AB23CD7 otro")).toBeNull();
    expect(extractLinkCode("ABCDE2 XY45ZT")).toBe("XY45ZT");
  });

  it("generates valid codes", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(isLinkCode(generateLinkCode())).toBe(true);
    }
  });
});
