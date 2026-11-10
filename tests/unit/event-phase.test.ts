import { describe, expect, it } from "vitest";

import {
  availableSeats,
  derivePhase,
  msUntilNextPhaseChange,
  type EventLifecycleStatus,
  type EventPhaseSnapshot,
} from "@/domain/event/event-phase";

const opensAt = new Date("2026-10-04T18:00:00.000Z");
const closesAt = new Date("2026-10-04T20:00:00.000Z");

function event(overrides: Partial<EventPhaseSnapshot> = {}): EventPhaseSnapshot {
  return {
    status: "SCHEDULED",
    opensAt,
    closesAt,
    capacity: 20,
    reservedSeats: 5,
    waitlistCapacity: 0,
    waitlistedCount: 0,
    ...overrides,
  };
}

describe("derivePhase", () => {
  it.each(["DRAFT", "CLOSED", "COMPLETED", "CANCELLED"] as const)(
    "returns the stored %s lifecycle status",
    (status: EventLifecycleStatus) => {
      expect(derivePhase(event({ status }), new Date("2026-10-04T19:00:00.000Z"))).toBe(status);
    },
  );

  it("is scheduled before the opening instant", () => {
    expect(derivePhase(event(), new Date(opensAt.getTime() - 1))).toBe("SCHEDULED");
  });

  it("is open exactly at opens_at", () => {
    expect(derivePhase(event(), opensAt)).toBe("OPEN");
  });

  it("is closed exactly at closes_at", () => {
    expect(derivePhase(event(), closesAt)).toBe("CLOSED");
  });

  it("is full during the open window when all seats are reserved and no queue is configured", () => {
    expect(derivePhase(event({ reservedSeats: 20 }), new Date("2026-10-04T19:00:00.000Z"))).toBe(
      "FULL",
    );
  });

  it("is waitlist-only when seats are gone and the queue has room", () => {
    const inWindow = new Date("2026-10-04T19:00:00.000Z");

    expect(
      derivePhase(event({ reservedSeats: 20, waitlistCapacity: 5, waitlistedCount: 4 }), inWindow),
    ).toBe("WAITLIST");
  });

  it("is full when seats and queue are both exhausted", () => {
    const inWindow = new Date("2026-10-04T19:00:00.000Z");

    expect(
      derivePhase(event({ reservedSeats: 20, waitlistCapacity: 5, waitlistedCount: 5 }), inWindow),
    ).toBe("FULL");
  });

  it("stays open while seats remain even if people are waiting", () => {
    expect(
      derivePhase(
        event({ reservedSeats: 19, waitlistCapacity: 5, waitlistedCount: 2 }),
        new Date("2026-10-04T19:00:00.000Z"),
      ),
    ).toBe("OPEN");
  });

  it("is open during the window while seats remain", () => {
    expect(derivePhase(event(), new Date("2026-10-04T19:00:00.000Z"))).toBe("OPEN");
  });
});

describe("availableSeats", () => {
  it("subtracts reserved seats from capacity", () => {
    expect(availableSeats(event())).toBe(15);
  });
});

describe("msUntilNextPhaseChange", () => {
  it("returns the time until opening", () => {
    expect(msUntilNextPhaseChange(event(), new Date(opensAt.getTime() - 5000))).toBe(5000);
  });

  it("returns the time until closing during the window", () => {
    expect(msUntilNextPhaseChange(event(), opensAt)).toBe(closesAt.getTime() - opensAt.getTime());
  });

  it("returns null at and after closing", () => {
    expect(msUntilNextPhaseChange(event(), closesAt)).toBeNull();
    expect(msUntilNextPhaseChange(event(), new Date(closesAt.getTime() + 1))).toBeNull();
  });

  it.each(["DRAFT", "CLOSED"] as const)("returns null for %s", (status) => {
    expect(msUntilNextPhaseChange(event({ status }), new Date(opensAt.getTime() - 1))).toBeNull();
  });
});
