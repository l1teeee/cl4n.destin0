import { describe, expect, it } from "vitest";

import { locationMap } from "@/ui/admin/view-model";

describe("location map", () => {
  it("points at the exact coordinates when known", () => {
    expect(
      locationMap({
        name: "Casa",
        address: "Calle 1",
        mapsUrl: "https://maps.app.goo.gl/abc",
        latitude: 13.69,
        longitude: -89.21,
      }),
    ).toEqual({
      src: "https://www.google.com/maps?q=13.69,-89.21&z=17&output=embed",
      caption: "Punto exacto del enlace de Google Maps.",
    });
  });

  it("names Waze in the caption of a Waze link", () => {
    expect(
      locationMap({
        name: "Casa",
        address: null,
        mapsUrl: "https://waze.com/ul?ll=13.69,-89.21",
        latitude: 13.69,
        longitude: -89.21,
      })?.caption,
    ).toBe("Punto exacto del enlace de Waze.");
  });

  it("falls back to the address with newlines flattened", () => {
    const map = locationMap({
      name: "Casa",
      address: "Calle 1\nColonia",
      mapsUrl: null,
      latitude: null,
      longitude: null,
    });
    expect(map?.src).toBe(
      `https://www.google.com/maps?q=${encodeURIComponent("Casa, Calle 1, Colonia")}&output=embed`,
    );
    expect(map?.caption).toContain("Ubicación aproximada");
    expect(map?.caption).toContain("Pega un enlace de Google Maps o de Waze");
  });

  it("returns null without coordinates or address", () => {
    expect(
      locationMap({ name: "Casa", address: null, mapsUrl: null, latitude: null, longitude: null }),
    ).toBeNull();
  });
});
