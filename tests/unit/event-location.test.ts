import { describe, expect, it } from "vitest";

import { isAllowedGoogleMapsUrl } from "@/contracts/admin-event";
import { detectEventImageContentType } from "@/contracts/event-image";
import { isEventLocationConfirmationValid } from "@/domain/event/event-location";

describe("Google Maps URL allowlist", () => {
  it.each([
    "https://maps.app.goo.gl/abc",
    "https://www.google.com/maps/place/example",
    "https://www.google.com.sv/maps/place/example",
    "https://goo.gl/maps/abc",
    "https://maps.google.com/?q=x",
    "https://google.com/maps/place/x",
  ])("accepts %s", (url) => {
    expect(isAllowedGoogleMapsUrl(url)).toBe(true);
  });

  it.each([
    "http://maps.app.goo.gl/abc",
    "javascript:alert(1)",
    "https://evil.com/maps",
    "https://www.google.com/search?q=x",
    "https://maps.app.goo.gl.evil.com/x",
    "https://google.evil.com/maps/x",
    "https://www.google.attacker.io/maps/x",
    "https://goo.gl/other",
  ])("rejects %s", (url) => {
    expect(isAllowedGoogleMapsUrl(url)).toBe(false);
  });
});

describe("location confirmation rule", () => {
  it("allows pending locations and confirmed locations with an address or Maps link", () => {
    expect(
      isEventLocationConfirmationValid({ status: "PENDING", address: null, mapsUrl: null }),
    ).toBe(true);
    expect(
      isEventLocationConfirmationValid({
        status: "CONFIRMED",
        address: "San Salvador",
        mapsUrl: null,
      }),
    ).toBe(true);
    expect(
      isEventLocationConfirmationValid({
        status: "CONFIRMED",
        address: null,
        mapsUrl: "https://maps.app.goo.gl/abc",
      }),
    ).toBe(true);
  });

  it("rejects an incomplete confirmed location", () => {
    expect(
      isEventLocationConfirmationValid({ status: "CONFIRMED", address: null, mapsUrl: null }),
    ).toBe(false);
  });
});

describe("event image magic bytes", () => {
  it.each([
    [new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"],
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), "image/webp"],
  ])("accepts supported bytes", (bytes, contentType) => {
    expect(detectEventImageContentType(bytes)).toBe(contentType);
  });

  it.each([
    new TextEncoder().encode("GIF89a"),
    new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>"),
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([0x89, 0x50, 0x4e]),
    new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  ])("rejects unsupported or truncated bytes", (bytes) => {
    expect(detectEventImageContentType(bytes)).toBeNull();
  });
});
