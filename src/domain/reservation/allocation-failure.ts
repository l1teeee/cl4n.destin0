import type { EventLifecycleStatus } from "../event/event-phase";

export type AllocationFailure =
  "EVENT_NOT_OPEN" | "PARTY_SIZE_NOT_ALLOWED" | "EVENT_FULL" | "TRY_AGAIN";

export interface AllocationFailureSnapshot {
  status: EventLifecycleStatus;
  opensAt: Date;
  closesAt: Date;
  capacity: number;
  reservedSeats: number;
  maxPartySize: number;
}

export function classifyAllocationFailure(
  snapshot: AllocationFailureSnapshot,
  partySize: number,
  now: Date,
): AllocationFailure {
  const outsideWindow = now < snapshot.opensAt || now >= snapshot.closesAt;

  if (outsideWindow) {
    return "EVENT_NOT_OPEN";
  }

  if (snapshot.status === "SCHEDULED") {
    if (partySize > snapshot.maxPartySize) {
      return "PARTY_SIZE_NOT_ALLOWED";
    }

    if (snapshot.reservedSeats + partySize > snapshot.capacity) {
      return "EVENT_FULL";
    }

    return "TRY_AGAIN";
  }

  if (snapshot.status === "CLOSED" && snapshot.reservedSeats >= snapshot.capacity) {
    return "EVENT_FULL";
  }

  return "EVENT_NOT_OPEN";
}
