import { canPublishClues } from "@/domain/event/event-clues";

import type { EventClueRepository } from "./event-clue-repository";
import type { EventRepository } from "./event-repository";

interface PublishEventClueInput {
  eventId: string;
  body: string;
  actorId: string;
}

interface RemoveEventClueInput {
  eventId: string;
  clueId: string;
  actorId: string;
}

export async function publishEventClue(
  events: EventRepository,
  clues: EventClueRepository,
  input: PublishEventClueInput,
) {
  const detail = (await events.getAdminEvent(input.eventId)).value;
  if (!detail) return { ok: false as const, error: "EVENT_NOT_FOUND" as const };
  if (!canPublishClues(detail.phase)) {
    return { ok: false as const, error: "CLUES_CLOSED" as const };
  }

  // WHY: a concurrent reopen after this phase check is an accepted product trade-off.
  return clues.add(input);
}

export async function removeEventClue(
  events: EventRepository,
  clues: EventClueRepository,
  input: RemoveEventClueInput,
) {
  const detail = (await events.getAdminEvent(input.eventId)).value;
  if (!detail) return { ok: false as const, error: "EVENT_NOT_FOUND" as const };
  if (!canPublishClues(detail.phase)) {
    return { ok: false as const, error: "CLUES_CLOSED" as const };
  }

  const removed = await clues.remove(input);
  return removed ? { ok: true as const } : { ok: false as const, error: "CLUE_NOT_FOUND" as const };
}
