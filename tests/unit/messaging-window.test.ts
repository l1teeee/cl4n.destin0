import { describe, expect, it } from "vitest";

import { isMessagingWindowOpen } from "@/domain/messaging/messaging-window";

describe("messaging window", () => {
  const now = new Date("2026-10-30T18:00:00.000Z");

  it("requires a last inbound message", () => {
    expect(isMessagingWindowOpen(null, now)).toBe(false);
  });

  it("is open strictly inside the 23 hour 55 minute margin", () => {
    expect(isMessagingWindowOpen(new Date("2026-10-29T18:05:00.001Z"), now)).toBe(true);
    expect(isMessagingWindowOpen(new Date("2026-10-29T18:05:00.000Z"), now)).toBe(false);
    expect(isMessagingWindowOpen(new Date("2026-10-29T18:04:59.999Z"), now)).toBe(false);
  });
});
