import { describe, expect, it } from "vitest";

import {
  availableSeats,
  derivePhase,
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

  it("is full during the open window when all seats are reserved", () => {
    expect(derivePhase(event({ reservedSeats: 20 }), new Date("2026-10-04T19:00:00.000Z"))).toBe(
      "FULL",
    );
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
