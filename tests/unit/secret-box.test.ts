import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/infrastructure/crypto/secret-box";

const context = "instagram_connection.access_token";

describe("secret box", () => {
  it("round trips UTF-8 secrets with a fresh IV for each encryption", () => {
    const key = randomBytes(32);
    const plaintext = "token privado con acentos: áñ";
    const encrypted = encryptSecret(plaintext, key, context);
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted, key, context)).toBe(plaintext);
    expect(encryptSecret(plaintext, key, context)).not.toBe(encrypted);
    expect(decryptSecret(encryptSecret("", key, context), key, context)).toBe("");
  });

  it("rejects the wrong key, context and tampered ciphertext", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret("private-token", key, context);
    expect(() => decryptSecret(encrypted, randomBytes(32), context)).toThrow(
      "Invalid encrypted secret",
    );
    expect(() => decryptSecret(encrypted, key, "another.column")).toThrow(
      "Invalid encrypted secret",
    );
    const parts = encrypted.split(".");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[3] = ciphertext.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, context)).toThrow("Invalid encrypted secret");
  });

  it.each(["", "v2.a.b.c", "v1.a.b", "v1.a.b.c.extra", "v1.!.!.!", "v1.YQ.Yg.Yw"])(
    "rejects invalid payload %j",
    (payload) => {
      expect(() => decryptSecret(payload, randomBytes(32), context)).toThrow(
        "Invalid encrypted secret",
      );
    },
  );

  it.each([0, 16, 31, 33])("rejects a %i-byte key for both operations", (length) => {
    const payload = encryptSecret("secret", randomBytes(32), context);
    expect(() => encryptSecret("secret", Buffer.alloc(length), context)).toThrow();
    expect(() => decryptSecret(payload, Buffer.alloc(length), context)).toThrow(
      "Invalid encrypted secret",
    );
  });
});
