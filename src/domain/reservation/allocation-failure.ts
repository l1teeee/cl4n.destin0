import type { EventLifecycleStatus } from "../event/event-phase";

export type AllocationFailure = "EVENT_NOT_OPEN" | "PARTY_SIZE_NOT_ALLOWED" | "EVENT_FULL";

export interface AllocationFailureSnapshot {
  status: EventLifecycleStatus;
  opensAt: Date;
  closesAt: Date;
  maxPartySize: number;
}

export function classifyAllocationFailure(
  snapshot: AllocationFailureSnapshot,
  partySize: number,
  now: Date,
): AllocationFailure {
  const outsideWindow = now < snapshot.opensAt || now >= snapshot.closesAt;

  if (snapshot.status !== "SCHEDULED" || outsideWindow) {
    return "EVENT_NOT_OPEN";
  }

  if (partySize > snapshot.maxPartySize) {
    return "PARTY_SIZE_NOT_ALLOWED";
  }

  return "EVENT_FULL";
}
