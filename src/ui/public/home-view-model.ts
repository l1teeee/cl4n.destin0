import type { PublicEvent } from "@/application/events/types";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

export type HomeViewModel =
  | {
      state: "OPEN";
      events: Array<{ slug: string; formattedDate: string }>;
    }
  | { state: "FULL" }
  | { state: "CLOSED" };

export function buildHomeViewModel(readModel: readonly PublicEvent[]): HomeViewModel {
  const openEvents = readModel.filter((event) => event.phase === "OPEN");
  if (openEvents.length > 0) {
    return {
      state: "OPEN",
      events: openEvents.map((event) => ({
        slug: event.slug,
        formattedDate: formatPublicEventDate(event.startsAt),
      })),
    };
  }

  if (readModel.some((event) => event.phase === "FULL")) {
    return { state: "FULL" };
  }

  return { state: "CLOSED" };
}
