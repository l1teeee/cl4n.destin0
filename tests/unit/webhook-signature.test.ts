import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isValidSignature } from "@/infrastructure/instagram/webhook-signature";

describe("Instagram webhook signature", () => {
  const body = Buffer.from('{"object":"instagram"}');
  const secret = "a-secret-with-enough-entropy";
  const valid = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts a valid signature", () => {
    expect(isValidSignature(body, valid, secret)).toBe(true);
  });

  it.each([
    ["wrong secret", valid, "another-secret"],
    ["missing", null, secret],
    ["malformed", "sha256=not-hex", secret],
    ["length mismatch", "sha256=abcd", secret],
  ])("rejects %s", (_label, header, key) => {
    expect(isValidSignature(body, header, key)).toBe(false);
  });
});
