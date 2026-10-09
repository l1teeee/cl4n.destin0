import { describe, expect, it } from "vitest";

import {
  chooseStoredCoordinates,
  parseMapsCoordinates,
  reconcileMapsLink,
} from "@/domain/event/event-location";

describe("reconcileMapsLink", () => {
  const link = "https://www.google.com/maps/place/Casa/@13.69,-89.21,17z";

  it("clears the previous link when only the address changed", () => {
    expect(
      reconcileMapsLink(
        { address: "Calle 1", mapsUrl: link },
        { address: "Calle 2", mapsUrl: link },
        false,
      ),
    ).toEqual({ mapsUrl: null, mapsUrlCleared: true });
  });

  it("keeps the link when the owner asks to keep it", () => {
    expect(
      reconcileMapsLink(
        { address: "Calle 1", mapsUrl: link },
        { address: "Calle 2", mapsUrl: link },
        true,
      ),
    ).toEqual({ mapsUrl: link, mapsUrlCleared: false });
  });

  it("keeps a new link pasted together with the new address", () => {
    const fresh = "https://www.google.com/maps/place/Otra/@13.7,-89.2,17z";
    expect(
      reconcileMapsLink(
        { address: "Calle 1", mapsUrl: link },
        { address: "Calle 2", mapsUrl: fresh },
        false,
      ),
    ).toEqual({ mapsUrl: fresh, mapsUrlCleared: false });
  });

  it("ignores whitespace-only address differences", () => {
    expect(
      reconcileMapsLink(
        { address: "Calle 1  Colonia", mapsUrl: link },
        { address: " Calle 1 \n Colonia ", mapsUrl: link },
        false,
      ),
    ).toEqual({ mapsUrl: link, mapsUrlCleared: false });
  });

  it("treats a changed case as a change", () => {
    expect(
      reconcileMapsLink(
        { address: "calle 1", mapsUrl: link },
        { address: "Calle 1", mapsUrl: link },
        false,
      ).mapsUrlCleared,
    ).toBe(true);
  });

  it("does nothing when there was no previous link", () => {
    expect(
      reconcileMapsLink(
        { address: "Calle 1", mapsUrl: null },
        { address: "Calle 2", mapsUrl: null },
        false,
      ),
    ).toEqual({ mapsUrl: null, mapsUrlCleared: false });
  });
});

describe("parseMapsCoordinates", () => {
  it("prefers the place pin over the viewport", () => {
    expect(
      parseMapsCoordinates(
        "https://www.google.com/maps/place/Casa/@13.1,-89.1,17z/data=!3m1!4b1!4m6!3d13.6929!4d-89.2182",
      ),
    ).toEqual({ latitude: 13.6929, longitude: -89.2182 });
  });

  it("falls back to the viewport", () => {
    expect(parseMapsCoordinates("https://www.google.com/maps/@13.7,-89.2,15z")).toEqual({
      latitude: 13.7,
      longitude: -89.2,
    });
  });

  it.each(["q", "query", "ll", "center", "destination"])("reads the %s query parameter", (name) => {
    expect(parseMapsCoordinates(`https://www.google.com/maps?${name}=13.5,-89.5`)).toEqual({
      latitude: 13.5,
      longitude: -89.5,
    });
  });

  it("accepts a space after the comma in a query value", () => {
    expect(parseMapsCoordinates("https://www.google.com/maps?q=13.69, -89.21")).toEqual({
      latitude: 13.69,
      longitude: -89.21,
    });
  });

  it("rejects out-of-range values", () => {
    expect(parseMapsCoordinates("https://www.google.com/maps/@91.0,-89.2,15z")).toBeNull();
    expect(parseMapsCoordinates("https://www.google.com/maps?q=13.5,-181")).toBeNull();
  });

  it.each([
    "not a url",
    "https://www.google.com/maps/place/Casa",
    "https://www.google.com/maps?q=Casa+Blanca",
    "https://maps.app.goo.gl/abc123",
  ])("returns null for %s", (value) => {
    expect(parseMapsCoordinates(value)).toBeNull();
  });
});

describe("chooseStoredCoordinates", () => {
  const stored = { latitude: 1, longitude: 2 };
  const resolved = { latitude: 3, longitude: 4 };
  const link = "https://maps.app.goo.gl/a";

  it("keeps the stored point when an unchanged link could not be resolved", () => {
    expect(
      chooseStoredCoordinates({
        previousMapsUrl: link,
        previousCoordinates: stored,
        nextMapsUrl: link,
        resolvedCoordinates: null,
      }),
    ).toEqual(stored);
  });

  it("drops the stored point when the link changed and nothing resolved", () => {
    expect(
      chooseStoredCoordinates({
        previousMapsUrl: link,
        previousCoordinates: stored,
        nextMapsUrl: "https://maps.app.goo.gl/b",
        resolvedCoordinates: null,
      }),
    ).toBeNull();
  });

  it("uses freshly resolved coordinates and clears them without a link", () => {
    expect(
      chooseStoredCoordinates({
        previousMapsUrl: link,
        previousCoordinates: stored,
        nextMapsUrl: link,
        resolvedCoordinates: resolved,
      }),
    ).toEqual(resolved);
    expect(
      chooseStoredCoordinates({
        previousMapsUrl: link,
        previousCoordinates: stored,
        nextMapsUrl: null,
        resolvedCoordinates: null,
      }),
    ).toBeNull();
  });
});
