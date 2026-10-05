import { describe, expect, it } from "vitest";

import type { PublicEvent } from "@/application/events/types";
import { buildHomeViewModel } from "@/ui/public/home-view-model";

function event(slug: string, phase: PublicEvent["phase"]): PublicEvent {
  return {
    slug,
    phase,
    startsAt: new Date("2026-11-22T01:30:00.000Z"),
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

  it("shows closed when the read model has neither open nor full events", () => {
    expect(buildHomeViewModel([event("proxima", "SCHEDULED")])).toEqual({ state: "CLOSED" });
  });
});
