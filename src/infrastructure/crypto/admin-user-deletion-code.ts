import { randomInt } from "node:crypto";

import { keyedHash } from "./keyed-hash";

export function generateAdminUserDeletionCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashAdminUserDeletionCode(actorId: string, targetId: string, code: string): string {
  return keyedHash(`admin-user-delete:${actorId}:${targetId}:${code}`);
}
