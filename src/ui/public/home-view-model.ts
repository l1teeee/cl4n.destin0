import { es } from "date-fns/locale";

import type { PublicEvent } from "@/application/events/types";
import {
  formatPublicEventDate,
  formatUtcForElSalvador,
} from "@/infrastructure/time/el-salvador-time";

export interface PublicEventDateParts {
  weekday: string;
  day: string;
  month: string;
  time: string;
}

export type HomeViewModel =
  | {
      state: "OPEN";
      events: Array<{
        slug: string;
        formattedDate: string;
        dateParts: PublicEventDateParts;
        waitlistOnly?: true;
      }>;
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

// Same locale and time zone as formatPublicEventDate, split so the home can lay the date out.
function buildDateParts(startsAt: Date): PublicEventDateParts {
  const period = Number(formatUtcForElSalvador(startsAt, "H")) < 12 ? "a. m." : "p. m.";
  return {
    weekday: formatUtcForElSalvador(startsAt, "EEEE", es),
    day: formatUtcForElSalvador(startsAt, "d", es),
    month: formatUtcForElSalvador(startsAt, "MMMM", es),
    time: `${formatUtcForElSalvador(startsAt, "h:mm", es)} ${period}`,
  };
}

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
        dateParts: buildDateParts(event.startsAt),
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
