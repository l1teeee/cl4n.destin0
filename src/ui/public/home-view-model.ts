import type { PublicEvent } from "@/application/events/types";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

export type HomeViewModel =
  | {
      state: "OPEN";
      events: Array<{ slug: string; formattedDate: string; waitlistOnly?: true }>;
    }
  | { state: "FULL" }
  | { state: "SCHEDULED"; opensAt: Date }
  | { state: "CLOSED" };

export type ClosedStateVariant =
  { state: "SCHEDULED"; opensAt: Date } | { state: "FULL" | "CLOSED" | "DEFAULT" };

export type RequestAccessViewModel =
  | { state: "RESERVATION" }
  | { state: "NOT_FOUND" }
  | { state: "CLOSED"; variant: ClosedStateVariant };

export function buildHomeViewModel(readModel: readonly PublicEvent[]): HomeViewModel {
  const reservableEvents = readModel.filter(
    (event) => event.phase === "OPEN" || event.phase === "WAITLIST",
  );
  if (reservableEvents.length > 0) {
    return {
      state: "OPEN",
      events: reservableEvents.map((event) => ({
        slug: event.slug,
        formattedDate: formatPublicEventDate(event.startsAt),
        ...(event.phase === "WAITLIST" ? { waitlistOnly: true as const } : {}),
      })),
    };
  }

  const scheduledEvent = readModel
    .filter((event) => event.phase === "SCHEDULED")
    .sort((left, right) => left.opensAt.getTime() - right.opensAt.getTime())[0];
  if (scheduledEvent) {
    return { state: "SCHEDULED", opensAt: scheduledEvent.opensAt };
  }

  if (readModel.some((event) => event.phase === "FULL")) {
    return { state: "FULL" };
  }

  return { state: "CLOSED" };
}

export function buildRequestAccessViewModel(event: PublicEvent): RequestAccessViewModel {
  switch (event.phase) {
    case "DRAFT":
      return { state: "NOT_FOUND" };
    case "OPEN":
    case "WAITLIST":
      return { state: "RESERVATION" };
    case "SCHEDULED":
      return { state: "CLOSED", variant: { state: "SCHEDULED", opensAt: event.opensAt } };
    case "FULL":
      return { state: "CLOSED", variant: { state: "FULL" } };
    case "CLOSED":
      return { state: "CLOSED", variant: { state: "CLOSED" } };
    case "COMPLETED":
    case "CANCELLED":
      return { state: "CLOSED", variant: { state: "DEFAULT" } };
  }
}
