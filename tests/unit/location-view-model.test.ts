import { describe, expect, it } from "vitest";

import { locationMap } from "@/ui/admin/view-model";

describe("location map", () => {
  it("points at the exact coordinates when known", () => {
    expect(
      locationMap({ name: "Casa", address: "Calle 1", latitude: 13.69, longitude: -89.21 }),
    ).toEqual({
      src: "https://www.google.com/maps?q=13.69,-89.21&z=17&output=embed",
      caption: "Punto exacto del enlace de Google Maps.",
    });
  });

  it("falls back to the address with newlines flattened", () => {
    const map = locationMap({
      name: "Casa",
      address: "Calle 1\nColonia",
      latitude: null,
      longitude: null,
    });
    expect(map?.src).toBe(
      `https://www.google.com/maps?q=${encodeURIComponent("Casa, Calle 1, Colonia")}&output=embed`,
    );
    expect(map?.caption).toContain("Ubicación aproximada");
  });

  it("returns null without coordinates or address", () => {
    expect(
      locationMap({ name: "Casa", address: null, latitude: null, longitude: null }),
    ).toBeNull();
  });
});
