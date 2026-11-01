import { createHmac, timingSafeEqual } from "node:crypto";

export function isValidSignature(
  rawBody: Buffer,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const hex = header.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(hex)) return false;

  const supplied = Buffer.from(hex, "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
