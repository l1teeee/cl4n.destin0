import type { EventLifecycleStatus } from "./event-phase";

export const allowedLifecycleTransitions = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["CLOSED", "CANCELLED"],
  CLOSED: ["SCHEDULED", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies Record<EventLifecycleStatus, readonly EventLifecycleStatus[]>;

export function canTransition(from: EventLifecycleStatus, to: EventLifecycleStatus): boolean {
  return allowedLifecycleTransitions[from].some((allowed) => allowed === to);
}
