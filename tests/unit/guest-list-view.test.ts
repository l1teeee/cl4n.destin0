import { describe, expect, it } from "vitest";

import { EVENT_GUEST_VIEWS } from "@/application/guests/guest-views";
import type { EventGuestCounts } from "@/infrastructure/db/repositories/event-guest-queries";
import {
  DEFAULT_GUEST_VIEW,
  guestSummaryItems,
  guestViewHref,
  guestViewTabs,
  parseGuestView,
} from "@/ui/admin/guests/guest-list-view";

const eventId = "00000000-0000-4000-8000-000000000001";

const counts: EventGuestCounts = {
  counts: {
    "por-revisar": 3,
    "en-la-lista": 5,
    confirmados: 4,
    cola: 2,
    descartados: 6,
    "sin-lugar": 9,
    todas: 29,
  },
  occupiedSeats: 12,
  capacity: 20,
  waitlisted: 2,
  waitlistCapacity: 5,
  pendingMessages: 7,
};

describe("parseGuestView", () => {
  it("opens the requests waiting for a review by default", () => {
    expect(DEFAULT_GUEST_VIEW).toBe("por-revisar");
    expect(parseGuestView(undefined)).toBe("por-revisar");
    expect(parseGuestView("")).toBe("por-revisar");
  });

  it.each(EVENT_GUEST_VIEWS)("accepts the %s view", (view) => {
    expect(parseGuestView(view)).toBe(view);
  });

  it("reads only the first value of a repeated parameter", () => {
    expect(parseGuestView(["cola", "todas"])).toBe("cola");
  });

  it("falls back to the default for unknown values and object property names", () => {
    expect(parseGuestView("invalida")).toBe("por-revisar");
    expect(parseGuestView("constructor")).toBe("por-revisar");
    expect(parseGuestView("__proto__")).toBe("por-revisar");
  });

  it.each([
    ["confirmadas", "confirmados"],
    ["en-cola", "cola"],
    ["rechazadas", "descartados"],
    ["canceladas", "descartados"],
  ])("maps the old roster view %s to %s", (legacy, expected) => {
    expect(parseGuestView(legacy)).toBe(expected);
  });
});

describe("guestViewTabs", () => {
  it("lists the seven views in order with their counts", () => {
    expect(guestViewTabs(eventId, counts).map((tab) => [tab.label, tab.count])).toEqual([
      ["Por revisar", 3],
      ["En la lista", 5],
      ["Confirmados", 4],
      ["Cola", 2],
      ["Descartados", 6],
      ["Sin lugar", 9],
      ["Todas", 29],
    ]);
  });

  it("links every tab to the guests section of the event with its view", () => {
    const tabs = guestViewTabs(eventId, counts);

    expect(tabs.map((tab) => tab.id)).toEqual([...EVENT_GUEST_VIEWS]);
    expect(tabs[0]!.href).toBe(`/admin/events/${eventId}?seccion=invitados&vista=por-revisar`);
    expect(tabs[3]!.href).toBe(guestViewHref(eventId, "cola"));
    expect(guestViewHref(eventId, "en-la-lista")).toBe(
      `/admin/events/${eventId}?seccion=invitados&vista=en-la-lista`,
    );
  });
});

describe("guestSummaryItems", () => {
  it("summarises occupancy, the three stages, the queue and the pending messages", () => {
    expect(guestSummaryItems(counts)).toEqual([
      { label: "Lugares ocupados", value: "12 de 20" },
      { label: "Por revisar", value: "3" },
      { label: "En la lista", value: "5" },
      { label: "Confirmados", value: "4" },
      { label: "Cola", value: "2/5" },
      { label: "Mensajes pendientes", value: "7" },
    ]);
  });
});
