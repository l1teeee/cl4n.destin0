import { describe, expect, it } from "vitest";

import { isEventImagePublicToken } from "@/contracts/event-image";

describe("isEventImagePublicToken", () => {
  it("accepts exactly 43 URL-safe base64 characters", () => {
    expect(isEventImagePublicToken("Abc_123-xyz".padEnd(43, "Q"))).toBe(true);
  });

  it.each(["", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}+`, `${"a".repeat(42)}/`])(
    "rejects %s",
    (token) => {
      expect(isEventImagePublicToken(token)).toBe(false);
    },
  );
});
