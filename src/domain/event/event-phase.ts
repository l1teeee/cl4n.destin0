export type EventLifecycleStatus = "DRAFT" | "SCHEDULED" | "CLOSED" | "COMPLETED" | "CANCELLED";

export type EventPhase = EventLifecycleStatus | "OPEN" | "WAITLIST" | "FULL";

export interface EventPhaseSnapshot {
  status: EventLifecycleStatus;
  opensAt: Date;
  closesAt: Date;
  capacity: number;
  reservedSeats: number;
  waitlistCapacity: number;
  waitlistedCount: number;
}

// Milliseconds until the scheduled event opens or closes; null when no time-based change is ahead.
export function msUntilNextPhaseChange(
  event: Pick<EventPhaseSnapshot, "status" | "opensAt" | "closesAt">,
  now: Date,
): number | null {
  if (event.status !== "SCHEDULED") return null;
  if (now < event.opensAt) return event.opensAt.getTime() - now.getTime();
  if (now < event.closesAt) return event.closesAt.getTime() - now.getTime();
  return null;
}

export function derivePhase(event: EventPhaseSnapshot, now: Date): EventPhase {
  if (event.status !== "SCHEDULED") {
    return event.status;
  }

  if (now < event.opensAt) {
    return "SCHEDULED";
  }

  if (now >= event.closesAt) {
    return "CLOSED";
  }

  if (event.reservedSeats >= event.capacity) {
    return event.waitlistedCount < event.waitlistCapacity ? "WAITLIST" : "FULL";
  }

  return "OPEN";
}

export function availableSeats(
  event: Pick<EventPhaseSnapshot, "capacity" | "reservedSeats">,
): number {
  return event.capacity - event.reservedSeats;
}
