import { describe, expect, it } from "vitest";

import {
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
} from "@/domain/reservation/contact-normalization";

describe("contact normalization", () => {
  it.each([
    ["7123 4567", "+50371234567"],
    ["+503 7123-4567", "+50371234567"],
    ["22223333", "+50322223333"],
  ])("normalizes the Salvadoran phone %s", (input, expected) => {
    expect(normalizePhone(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "123", "+503 9999 9999", "not-a-phone"])(
    "rejects invalid phone input %j",
    (input) => {
      expect(normalizePhone(input).ok).toBe(false);
    },
  );

  it("trims and lowercases email without provider-specific rewriting", () => {
    expect(normalizeEmail("  User.Name+tag@GMAIL.com ")).toEqual({
      ok: true,
      value: "user.name+tag@gmail.com",
    });
  });

  it("normalizes an Instagram handle", () => {
    expect(normalizeInstagram(" @User.Name ")).toEqual({ ok: true, value: "user.name" });
  });

  it.each(["@bad-name", "@space name", "@user!", `@${"a".repeat(31)}`])(
    "rejects invalid Instagram input %j",
    (input) => {
      expect(normalizeInstagram(input)).toEqual({ ok: false, reason: "INVALID_FORMAT" });
    },
  );
});
