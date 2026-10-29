import { describe, expect, it } from "vitest";

import {
  areCluesVisible,
  canPublishClues,
  numberCluesNewestFirst,
} from "@/domain/event/event-clues";
import type { EventPhase } from "@/domain/event/event-phase";

const phases: readonly EventPhase[] = [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "WAITLIST",
  "FULL",
  "CLOSED",
  "COMPLETED",
  "CANCELLED",
];

describe("event clue phase rules", () => {
  it.each(phases)("allows publishing only when the phase is CLOSED: %s", (phase) => {
    expect(canPublishClues(phase)).toBe(phase === "CLOSED");
  });

  it.each(phases)("shows clues only in CLOSED and COMPLETED: %s", (phase) => {
    expect(areCluesVisible(phase)).toBe(phase === "CLOSED" || phase === "COMPLETED");
  });
});

describe("numberCluesNewestFirst", () => {
  it("keeps chronological numbering and returns the newest clue first", () => {
    const clues = [
      { id: "first", body: "Uno", createdAt: new Date("2026-10-28T01:00:00Z") },
      { id: "second", body: "Dos", createdAt: new Date("2026-10-28T02:00:00Z") },
      { id: "third", body: "Tres", createdAt: new Date("2026-10-28T03:00:00Z") },
    ];

    expect(numberCluesNewestFirst(clues)).toEqual([
      { ...clues[2], number: 3 },
      { ...clues[1], number: 2 },
      { ...clues[0], number: 1 },
    ]);
    expect(clues.map((clue) => clue.id)).toEqual(["first", "second", "third"]);
  });
});
