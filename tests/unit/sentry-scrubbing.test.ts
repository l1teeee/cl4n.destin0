import { describe, expect, it } from "vitest";

import {
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubTokenFromUrl,
} from "@/infrastructure/observability/sentry-scrubbing";

describe("Sentry token scrubbing", () => {
  it.each([
    ["/admin/reset#token=fragment-secret", "/admin/reset#token=[Filtered]"],
    ["/admin/reset?token=query-secret", "/admin/reset?token=[Filtered]"],
    [
      "https://example.com/admin/reset?next=login&token=query-secret#token=fragment-secret",
      "https://example.com/admin/reset?next=login&token=[Filtered]#token=[Filtered]",
    ],
  ])("scrubs reset tokens from %s", (url, expected) => {
    expect(scrubTokenFromUrl(url)).toBe(expected);
  });

  it.each([
    ["/ubicacion/foto/abc_DEF-123", "/ubicacion/foto/[redacted]"],
    [
      "https://example.com/ubicacion/foto/abc_DEF-123?x=1",
      "https://example.com/ubicacion/foto/[redacted]?x=1",
    ],
  ])("redacts the location photo token from %s", (url, expected) => {
    expect(scrubTokenFromUrl(url)).toBe(expected);
  });

  it("scrubs navigation breadcrumb URL fields", () => {
    const breadcrumb = scrubSentryBreadcrumb({
      data: {
        from: "/admin/reset#token=from-secret",
        to: "/admin/reset?token=to-secret",
        url: "https://example.com/admin/reset#token=url-secret",
        method: "GET",
      },
    });

    expect(breadcrumb.data).toEqual({
      from: "/admin/reset#token=[Filtered]",
      to: "/admin/reset?token=[Filtered]",
      url: "https://example.com/admin/reset#token=[Filtered]",
      method: "GET",
    });
  });

  it("scrubs the event request and its collected breadcrumbs", () => {
    const event = scrubSentryEvent({
      type: undefined,
      event_id: "event-id",
      platform: "javascript",
      request: { url: "https://example.com/admin/reset?token=request-secret" },
      breadcrumbs: [{ data: { url: "/admin/reset#token=breadcrumb-secret" } }],
    });
    const serialized = JSON.stringify(event);

    expect(serialized).not.toContain("request-secret");
    expect(serialized).not.toContain("breadcrumb-secret");
    expect(event.request?.url).toBe("https://example.com/admin/reset?token=[Filtered]");
  });

  it("drops request bodies, cookies, user IP and credential headers", () => {
    const event = scrubSentryEvent({
      type: undefined,
      event_id: "event-id",
      platform: "javascript",
      request: {
        url: "https://example.com/api/reservations",
        data: { fullName: "Ana", allergies: "Maní" },
        cookies: { session: "session-secret" },
        headers: {
          Cookie: "session=session-secret",
          Authorization: "Bearer bearer-secret",
          "Set-Cookie": "session=set-secret",
          "User-Agent": "vitest",
        },
      },
      user: { id: "user-id", ip_address: "203.0.113.7" },
    });
    const serialized = JSON.stringify(event);

    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({ "User-Agent": "vitest" });
    expect(event.user).toEqual({ id: "user-id" });
    expect(serialized).not.toContain("Maní");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("203.0.113.7");
  });
});
