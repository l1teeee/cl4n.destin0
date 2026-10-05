import { describe, expect, it } from "vitest";

import { canTransition } from "@/domain/event/event-lifecycle";
import type { EventLifecycleStatus } from "@/domain/event/event-phase";

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
