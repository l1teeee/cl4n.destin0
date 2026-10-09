import { describe, expect, it, vi } from "vitest";

import { GoogleMapsLinkResolver } from "@/infrastructure/maps/google-maps-link-resolver";

const shortLink = "https://maps.app.goo.gl/abc123";
const fullLink = "https://www.google.com/maps/place/Casa/@13.69,-89.21,17z";

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function resolverWith(responses: Array<Response | Error>) {
  const fetchFake = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  });
  return { resolver: new GoogleMapsLinkResolver(fetchFake as unknown as typeof fetch), fetchFake };
}

describe("GoogleMapsLinkResolver", () => {
  it("follows allowed hops and returns the final URL", async () => {
    const { resolver, fetchFake } = resolverWith([
      redirectTo("https://goo.gl/maps/xyz"),
      redirectTo(fullLink),
      new Response(null, { status: 200 }),
    ]);

    expect(await resolver.expand(shortLink)).toBe(fullLink);
    expect(fetchFake).toHaveBeenCalledTimes(3);
    expect(fetchFake.mock.calls[0]).toEqual([
      shortLink,
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    ]);
  });

  it("stops at a host outside the allowlist without requesting it", async () => {
    const { resolver, fetchFake } = resolverWith([redirectTo("https://evil.example/maps")]);
    expect(await resolver.expand(shortLink)).toBeNull();
    expect(fetchFake).toHaveBeenCalledTimes(1);
  });

  it("refuses non-https hops", async () => {
    const { resolver } = resolverWith([redirectTo("http://www.google.com/maps/place/Casa")]);
    expect(await resolver.expand(shortLink)).toBeNull();
  });

  it("gives up after five redirects", async () => {
    const { resolver, fetchFake } = resolverWith(
      Array.from({ length: 7 }, () => redirectTo(fullLink)),
    );
    expect(await resolver.expand(shortLink)).toBeNull();
    expect(fetchFake).toHaveBeenCalledTimes(6);
  });

  it("accepts exactly five redirects", async () => {
    const { resolver } = resolverWith([
      ...Array.from({ length: 5 }, () => redirectTo(fullLink)),
      new Response(null, { status: 200 }),
    ]);
    expect(await resolver.expand(shortLink)).toBe(fullLink);
  });

  it("does not request URLs that are not short links", async () => {
    const { resolver, fetchFake } = resolverWith([]);
    expect(await resolver.expand(fullLink)).toBeNull();
    expect(await resolver.expand("https://evil.example/x")).toBeNull();
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("returns null when the request fails or times out", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    const { resolver } = resolverWith([timeout]);
    expect(await resolver.expand(shortLink)).toBeNull();
  });

  it("passes an abort signal to every request", async () => {
    const { resolver, fetchFake } = resolverWith([
      redirectTo(fullLink),
      new Response(null, { status: 200 }),
    ]);
    await resolver.expand(shortLink);
    for (const call of fetchFake.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });
});
