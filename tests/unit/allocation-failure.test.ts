import { describe, expect, it } from "vitest";

import {
  classifyAllocationFailure,
  type AllocationFailureSnapshot,
} from "@/domain/reservation/allocation-failure";

const opensAt = new Date("2026-10-04T18:00:00.000Z");
const closesAt = new Date("2026-10-04T20:00:00.000Z");
const now = new Date("2026-10-04T19:00:00.000Z");

function snapshot(overrides: Partial<AllocationFailureSnapshot> = {}): AllocationFailureSnapshot {
  return {
    status: "SCHEDULED",
    opensAt,
    closesAt,
    maxPartySize: 2,
    ...overrides,
  };
}

describe("classifyAllocationFailure", () => {
  it("prioritizes event availability over party size", () => {
    expect(classifyAllocationFailure(snapshot({ status: "CLOSED" }), 3, now)).toBe(
      "EVENT_NOT_OPEN",
    );
    expect(classifyAllocationFailure(snapshot(), 3, new Date(opensAt.getTime() - 1))).toBe(
      "EVENT_NOT_OPEN",
    );
    expect(classifyAllocationFailure(snapshot(), 3, closesAt)).toBe("EVENT_NOT_OPEN");
  });

  it("returns party size failure for an open event before considering fullness", () => {
    expect(classifyAllocationFailure(snapshot(), 3, now)).toBe("PARTY_SIZE_NOT_ALLOWED");
  });

  it("classifies any remaining failed allocation as full", () => {
    expect(classifyAllocationFailure(snapshot(), 2, now)).toBe("EVENT_FULL");
    expect(classifyAllocationFailure(snapshot(), 2, opensAt)).toBe("EVENT_FULL");
  });
});
