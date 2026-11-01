import { EVENT_GUEST_VIEWS, type EventGuestView } from "@/application/guests/guest-views";
import type { EventGuestCounts } from "@/infrastructure/db/repositories/event-guest-queries";

import type { GuestSummaryItem } from "./guest-summary-bar";
import type { GuestView } from "./guest-view-tabs";

export const DEFAULT_GUEST_VIEW: EventGuestView = "por-revisar";

const viewLabels: Record<EventGuestView, string> = {
  "por-revisar": "Por revisar",
  "en-la-lista": "En la lista",
  confirmados: "Confirmados",
  cola: "Cola",
  descartados: "Descartados",
  "sin-lugar": "Sin lugar",
  todas: "Todas",
};

// The messages panel and old bookmarks still link with the views of the previous roster.
const legacyViews = new Map<string, EventGuestView>([
  ["confirmadas", "confirmados"],
  ["en-cola", "cola"],
  ["rechazadas", "descartados"],
  ["canceladas", "descartados"],
]);

export function parseGuestView(value: string | string[] | undefined): EventGuestView {
  const raw = Array.isArray(value) ? value[0] : value;
  const current = EVENT_GUEST_VIEWS.find((view) => view === raw);
  if (current) return current;
  return legacyViews.get(raw ?? "") ?? DEFAULT_GUEST_VIEW;
}

export function guestViewHref(eventId: string, view: EventGuestView): string {
  return `/admin/events/${eventId}?seccion=invitados&vista=${view}`;
}

export function guestViewTabs(eventId: string, counts: EventGuestCounts): GuestView[] {
  return EVENT_GUEST_VIEWS.map((view) => ({
    id: view,
    label: viewLabels[view],
    count: counts.counts[view],
    href: guestViewHref(eventId, view),
  }));
}

export function guestSummaryItems(counts: EventGuestCounts): GuestSummaryItem[] {
  return [
    { label: "Lugares ocupados", value: `${counts.occupiedSeats} de ${counts.capacity}` },
    { label: "Por revisar", value: String(counts.counts["por-revisar"]) },
    { label: "En la lista", value: String(counts.counts["en-la-lista"]) },
    { label: "Confirmados", value: String(counts.counts.confirmados) },
    { label: "Cola", value: `${counts.waitlisted}/${counts.waitlistCapacity}` },
    { label: "Mensajes pendientes", value: String(counts.pendingMessages) },
  ];
}
