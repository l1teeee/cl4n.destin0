import { describe, expect, it } from "vitest";

import {
  getOrCreateAttemptKey,
  rotateAttemptKey,
  shouldRotateAttemptKey,
  type KeyStorage,
} from "@/ui/public/reservation-idempotency";

function memoryStorage(): KeyStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("reservation idempotency key lifecycle", () => {
  it("creates and persists one key for an event attempt series", () => {
    const storage = memoryStorage();
    const key = getOrCreateAttemptKey(storage, "cena", () => "first-key");

    expect(key).toBe("first-key");
    expect(storage.values.get("cl4n:idem:cena")).toBe("first-key");
  });

  it("reuses the persisted key on refresh", () => {
    const storage = memoryStorage();
    storage.setItem("cl4n:idem:cena", "persisted-key");

    expect(getOrCreateAttemptKey(storage, "cena", () => "unused-key")).toBe("persisted-key");
  });

  it("rotates and persists a new key", () => {
    const storage = memoryStorage();
    storage.setItem("cl4n:idem:cena", "old-key");

    expect(rotateAttemptKey(storage, "cena", () => "new-key")).toBe("new-key");
    expect(storage.values.get("cl4n:idem:cena")).toBe("new-key");
  });

  it.each([
    [201, undefined],
    [202, undefined],
    [400, "IDEMPOTENCY_KEY_REQUIRED"],
    [404, "EVENT_NOT_FOUND"],
    [409, "EVENT_FULL"],
    [409, "DUPLICATE_RESERVATION"],
    [409, "EVENT_NOT_OPEN"],
    [422, "PARTY_SIZE_NOT_ALLOWED"],
    [422, "IDEMPOTENCY_KEY_REUSED"],
  ] as const)("rotates after final outcome %s %s", (status, code) => {
    expect(shouldRotateAttemptKey({ status, ...(code ? { code } : {}) })).toBe(true);
  });

  it.each([
    [0, undefined],
    [403, "BOT_CHECK_FAILED"],
    [422, "VALIDATION_FAILED"],
    [429, "RATE_LIMITED"],
    [500, "INTERNAL_ERROR"],
    [503, "TRY_AGAIN"],
  ] as const)("keeps the key after retryable outcome %s %s", (status, code) => {
    expect(shouldRotateAttemptKey({ status, ...(code ? { code } : {}) })).toBe(false);
  });
});
