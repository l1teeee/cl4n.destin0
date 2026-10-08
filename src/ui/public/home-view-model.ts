import type { PublicEvent } from "@/application/events/types";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

export type HomeViewModel =
  | {
      state: "OPEN";
      events: Array<{ slug: string; formattedDate: string; waitlistOnly?: true }>;
    }
  | { state: "FULL" }
  | { state: "CLOSED" };

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

  if (readModel.some((event) => event.phase === "FULL")) {
    return { state: "FULL" };
  }

  return { state: "CLOSED" };
}
