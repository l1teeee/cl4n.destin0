import type { EventPhase } from "./event-phase";

export const MAX_EVENT_CLUE_LENGTH = 500;

export function canPublishClues(phase: EventPhase): boolean {
  return phase === "CLOSED";
}

export function areCluesVisible(phase: EventPhase): boolean {
  return phase === "CLOSED" || phase === "COMPLETED";
}

export function numberCluesNewestFirst<T extends { createdAt: Date; id: string }>(
  clues: readonly T[],
): Array<T & { number: number }> {
  return clues.map((clue, index) => ({ ...clue, number: index + 1 })).reverse();
}
