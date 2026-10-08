// WHY: Next wraps the matcher with an optional /_next/data prefix and .json and .rsc suffixes and
// compiles it with path-to-regexp, so only its own helper tests what production really runs.
// The docs name the helper unstable_doesProxyMatch, but Next 16.3 still exports it as
// unstable_doesMiddlewareMatch. The baseline import has to come first: the helper patches console
// and throws on every console call unless AsyncLocalStorage already exists.
import "next/dist/server/node-environment-baseline";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

// WHY: an empty nextConfig is exact because next.config.ts sets neither basePath nor i18n.
function proxyRunsFor(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url, nextConfig: {} });
}

describe("proxy matcher", () => {
  it.each([
    "/",
    "/concepto",
    "/solicitar/demo",
    "/admin",
    "/admin/login",
    "/admin/users",
    "/admin/events/00000000-0000-4000-8000-000000000001/export",
    "/api/reservations",
    "/api/health",
  ])("runs the proxy for %s", (path) => {
    expect(proxyRunsFor(path)).toBe(true);
  });

  it.each([
    "/fonts/funnel-sans-latin.woff2",
    "/fonts/funnel-sans-latin-ext.woff2",
    "/fonts/funnel-sans-OFL.txt",
    "/clandestino-logo.jpg",
    "/clandestino-wordmark.png",
    "/brand-mark.png",
    "/_next/static/chunks/x.js",
    "/favicon.ico",
  ])("skips the proxy for %s", (path) => {
    expect(proxyRunsFor(path)).toBe(false);
  });

  it.each(["png", "jpg", "jpeg", "svg", "webp", "ico", "woff2", "txt"])(
    "skips the proxy for any .%s file",
    (extension) => {
      expect(proxyRunsFor(`/new-public-asset.${extension}`)).toBe(false);
    },
  );
});
