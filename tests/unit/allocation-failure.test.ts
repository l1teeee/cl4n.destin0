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
    capacity: 20,
    reservedSeats: 19,
    maxPartySize: 2,
    ...overrides,
  };
}

describe("classifyAllocationFailure", () => {
  it("prioritizes the allocation window over every other failure", () => {
    expect(classifyAllocationFailure(snapshot(), 3, new Date(opensAt.getTime() - 1))).toBe(
      "EVENT_NOT_OPEN",
    );
    expect(classifyAllocationFailure(snapshot(), 3, closesAt)).toBe("EVENT_NOT_OPEN");
  });

  it("returns party size failure for a scheduled event before considering fullness", () => {
    expect(classifyAllocationFailure(snapshot(), 3, now)).toBe("PARTY_SIZE_NOT_ALLOWED");
  });

  it("classifies a scheduled allocation failure as full only when the party does not fit", () => {
    expect(classifyAllocationFailure(snapshot(), 2, now)).toBe("EVENT_FULL");
    expect(classifyAllocationFailure(snapshot(), 2, opensAt)).toBe("EVENT_FULL");
  });

  it("returns TRY_AGAIN when a scheduled in-window snapshot still has capacity", () => {
    expect(classifyAllocationFailure(snapshot(), 1, now)).toBe("TRY_AGAIN");
    expect(classifyAllocationFailure(snapshot({ reservedSeats: 0 }), 2, now)).toBe("TRY_AGAIN");
  });

  it("classifies an auto-closed sold-out event as full", () => {
    expect(
      classifyAllocationFailure(snapshot({ status: "CLOSED", reservedSeats: 20 }), 2, now),
    ).toBe("EVENT_FULL");
  });

  it("classifies other lifecycle states and non-full closed events as not open", () => {
    expect(classifyAllocationFailure(snapshot({ status: "DRAFT" }), 2, now)).toBe("EVENT_NOT_OPEN");
    expect(classifyAllocationFailure(snapshot({ status: "CLOSED" }), 2, now)).toBe(
      "EVENT_NOT_OPEN",
    );
  });
});
