import { randomBytes } from "node:crypto";

import { keyedHash } from "../crypto/keyed-hash";

export function generatePasswordResetToken(): string {
  return randomBytes(32).toString("base64url");
}

// WHY: the prefix keeps this hash domain separate from every other keyedHash use of APP_SECRET.
export function hashPasswordResetToken(token: string): string {
  return keyedHash(`admin-password-reset:${token}`);
}
