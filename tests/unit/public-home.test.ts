import { describe, expect, it } from "vitest";

import type { PublicEvent } from "@/application/events/types";
import { buildHomeViewModel, buildRequestAccessViewModel } from "@/ui/public/home-view-model";

function event(
  slug: string,
  phase: PublicEvent["phase"],
  opensAt = new Date("2026-11-20T18:00:00.000Z"),
): PublicEvent {
  return {
    slug,
    phase,
    startsAt: new Date("2026-11-22T01:30:00.000Z"),
    opensAt,
    maxPartySize: 2,
  };
}

describe("buildHomeViewModel", () => {
  it("builds every open event and excludes full events", () => {
    expect(
      buildHomeViewModel([
        event("primera-cena", "OPEN"),
        event("agotada", "FULL"),
        event("segunda-cena", "OPEN"),
      ]),
    ).toEqual({
      state: "OPEN",
      events: [
        {
          slug: "primera-cena",
          formattedDate: "Sábado 21 de noviembre, 7:30 p. m.",
        },
        {
          slug: "segunda-cena",
          formattedDate: "Sábado 21 de noviembre, 7:30 p. m.",
        },
      ],
    });
  });

  it("shows sold out when there are no open events and at least one is full", () => {
    expect(buildHomeViewModel([event("agotada", "FULL")])).toEqual({ state: "FULL" });
  });

  it("shows closed when there are no public events", () => {
    expect(buildHomeViewModel([])).toEqual({ state: "CLOSED" });
  });

  it("shows the earliest scheduled opening", () => {
    const later = new Date("2026-11-21T18:00:00.000Z");
    const earlier = new Date("2026-11-20T18:00:00.000Z");

    expect(
      buildHomeViewModel([
        event("posterior", "SCHEDULED", later),
        event("proxima", "SCHEDULED", earlier),
      ]),
    ).toEqual({ state: "SCHEDULED", opensAt: earlier });
  });

  it("prefers a scheduled opening over a full event", () => {
    const opensAt = new Date("2026-11-20T18:00:00.000Z");
    expect(buildHomeViewModel([event("agotada", "FULL"), event("proxima", "SCHEDULED")])).toEqual({
      state: "SCHEDULED",
      opensAt,
    });
  });

  it("keeps a waitlist-only event reservable and flags it", () => {
    expect(buildHomeViewModel([event("cola", "WAITLIST")])).toEqual({
      state: "OPEN",
      events: [
        {
          slug: "cola",
          formattedDate: "Sábado 21 de noviembre, 7:30 p. m.",
          waitlistOnly: true,
        },
      ],
    });
  });

  it.each([
    ["DRAFT", { state: "NOT_FOUND" }],
    ["OPEN", { state: "RESERVATION" }],
    ["WAITLIST", { state: "RESERVATION" }],
    [
      "SCHEDULED",
      {
        state: "CLOSED",
        variant: { state: "SCHEDULED", opensAt: new Date("2026-11-20T18:00:00.000Z") },
      },
    ],
    ["FULL", { state: "CLOSED", variant: { state: "FULL" } }],
    ["CLOSED", { state: "CLOSED", variant: { state: "CLOSED" } }],
    ["COMPLETED", { state: "CLOSED", variant: { state: "DEFAULT" } }],
    ["CANCELLED", { state: "CLOSED", variant: { state: "DEFAULT" } }],
  ] as const)("selects the solicitar view for %s", (phase, expected) => {
    expect(buildRequestAccessViewModel(event("cena", phase))).toEqual(expected);
  });
});
