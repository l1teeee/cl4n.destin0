import { describe, expect, it } from "vitest";

import { canDeleteEvent, canTransition } from "@/domain/event/event-lifecycle";
import type { EventLifecycleStatus, EventPhase } from "@/domain/event/event-phase";

const statuses: EventLifecycleStatus[] = ["DRAFT", "SCHEDULED", "CLOSED", "COMPLETED", "CANCELLED"];

const allowed = new Set([
  "DRAFT:SCHEDULED",
  "DRAFT:CANCELLED",
  "SCHEDULED:CLOSED",
  "SCHEDULED:CANCELLED",
  "CLOSED:SCHEDULED",
  "CLOSED:COMPLETED",
  "CLOSED:CANCELLED",
]);

describe("canTransition", () => {
  it("allows exactly the lifecycle transitions in the ADR", () => {
    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed.has(`${from}:${to}`));
      }
    }
  });
});

describe("canDeleteEvent", () => {
  it.each([
    ["DRAFT", true],
    ["SCHEDULED", true],
    ["OPEN", false],
    ["WAITLIST", false],
    ["FULL", false],
    ["CLOSED", true],
    ["COMPLETED", true],
    ["CANCELLED", true],
  ] satisfies [EventPhase, boolean][])("evaluates deletion for %s", (phase, expected) => {
    expect(canDeleteEvent(phase)).toBe(expected);
  });
});
