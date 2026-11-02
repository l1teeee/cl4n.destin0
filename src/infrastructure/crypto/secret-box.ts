import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptSecret(plaintext: string, key: Buffer, context: string): string {
  if (key.length !== 32) throw new Error("Invalid encrypted secret");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, key: Buffer, context: string): string {
  try {
    if (key.length !== 32) throw new Error("Invalid key");
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Invalid format");
    const encoded = parts.slice(1);
    if (encoded.some((part) => !/^[A-Za-z0-9_-]*$/.test(part))) throw new Error("Invalid format");
    const [iv, tag, ciphertext] = encoded.map((part) => Buffer.from(part, "base64url"));
    if (iv!.length !== 12 || tag!.length !== 16) throw new Error("Invalid format");
    if (
      encoded.some(
        (part, index) => Buffer.from(part, "base64url").toString("base64url") !== encoded[index],
      )
    ) {
      throw new Error("Invalid format");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv!);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Invalid encrypted secret");
  }
}
