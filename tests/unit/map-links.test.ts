import { describe, expect, it } from "vitest";

import { mapProviderOf } from "@/domain/event/map-links";

describe("mapProviderOf", () => {
  it.each([
    "https://maps.google.com/?q=casa",
    "https://maps.google.com.sv/place",
    "https://maps.google.co.uk/place",
    "https://www.google.com/maps/place",
    "https://google.com.sv/maps/place",
    "https://google.es/maps",
    "https://maps.app.goo.gl/abc",
    "https://goo.gl/maps/abc",
  ])("recognizes Google Maps: %s", (url) => {
    expect(mapProviderOf(url)).toBe("GOOGLE_MAPS");
  });

  it.each(["https://waze.com/ul", "https://www.waze.com/live-map", "https://ul.waze.com/ul"])(
    "recognizes Waze: %s",
    (url) => {
      expect(mapProviderOf(url)).toBe("WAZE");
    },
  );

  it.each([
    "bad url",
    "https://google.com/search",
    "https://goo.gl/abc",
    "https://waze.com.evil.com/ul",
    "https://maps.google.com.evil.com/maps",
    "https://example.com/maps",
  ])("rejects unrelated links: %s", (url) => {
    expect(mapProviderOf(url)).toBeNull();
  });
});
