import { describe, expect, it, vi } from "vitest";

import type { EventRepository } from "@/application/events/event-repository";
import { updateEvent, type UpdateEventInput } from "@/application/events/event-use-cases";
import type { MapsLinkResolver } from "@/application/events/maps-link-resolver";

const shortLink = "https://maps.app.goo.gl/abc123";
const expandedLink = "https://www.google.com/maps/place/Casa/@13.69,-89.21,17z";

function repositoryStoring(mapsUrl: string | null, latitude: number | null) {
  return {
    getAdminEvent: vi.fn().mockResolvedValue({
      databaseTime: new Date(),
      value: {
        location: { mapsUrl, latitude, longitude: latitude === null ? null : -89.21 },
      },
    }),
    update: vi.fn().mockResolvedValue({ ok: true, value: {} }),
  } as unknown as EventRepository & {
    update: ReturnType<typeof vi.fn>;
  };
}

function resolverSpy() {
  return { expand: vi.fn().mockResolvedValue(expandedLink) } satisfies MapsLinkResolver;
}

function inputWith(mapsUrl: string | null): UpdateEventInput {
  return { id: "event-id", location: { mapsUrl } } as UpdateEventInput;
}

describe("updateEvent short-link expansion", () => {
  it("skips the lookup when the link is unchanged and coordinates are stored", async () => {
    const repository = repositoryStoring(shortLink, 13.69);
    const resolver = resolverSpy();

    await updateEvent(repository, resolver, inputWith(shortLink), "admin");

    expect(resolver.expand).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ coordinates: null }),
      "admin",
    );
  });

  it("looks the link up when it changed", async () => {
    const repository = repositoryStoring("https://maps.app.goo.gl/old", 13.69);
    const resolver = resolverSpy();

    await updateEvent(repository, resolver, inputWith(shortLink), "admin");

    expect(resolver.expand).toHaveBeenCalledWith(shortLink);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ coordinates: { latitude: 13.69, longitude: -89.21 } }),
      "admin",
    );
  });

  it("looks the link up when the same link has no stored coordinates", async () => {
    const repository = repositoryStoring(shortLink, null);
    const resolver = resolverSpy();

    await updateEvent(repository, resolver, inputWith(shortLink), "admin");

    expect(resolver.expand).toHaveBeenCalledTimes(1);
  });
});
