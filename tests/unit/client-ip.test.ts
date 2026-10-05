import { describe, expect, it } from "vitest";

import { getRateLimitSubject, getRawClientIp } from "@/infrastructure/http/client-ip";

describe("getRawClientIp", () => {
  it("uses the first Vercel-forwarded IPv4 address", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(getRawClientIp(headers, "production")).toBe("203.0.113.9");
  });

  it("returns the raw validated IPv6 address", () => {
    const headers = new Headers({ "x-forwarded-for": "2001:0db8:abcd:0012:1234:5678:9abc:def0" });
    expect(getRawClientIp(headers, "preview")).toBe("2001:0db8:abcd:0012:1234:5678:9abc:def0");
  });

  it("normalizes an IPv4-mapped IPv6 address to IPv4", () => {
    const headers = new Headers({ "x-forwarded-for": "::ffff:203.0.113.9" });
    expect(getRawClientIp(headers, "production")).toBe("203.0.113.9");
  });

  it.each(["local", "test"] as const)("returns null in %s", (environment) => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    expect(getRawClientIp(headers, environment)).toBeNull();
  });

  it.each(["", "not-an-ip", "999.999.999.999", "garbage, 203.0.113.9"])(
    "returns null for garbage protected-environment input %j",
    (header) => {
      expect(getRawClientIp(new Headers({ "x-forwarded-for": header }), "production")).toBeNull();
    },
  );
});

describe("getRateLimitSubject", () => {
  it("preserves IPv4 addresses", () => {
    expect(getRateLimitSubject("203.0.113.9")).toBe("203.0.113.9");
  });

  it("collapses IPv6 addresses to a /64 prefix", () => {
    expect(getRateLimitSubject("2001:0db8:abcd:0012:1234:5678:9abc:def0")).toBe(
      "2001:db8:abcd:12::/64",
    );
  });

  it("treats IPv4-mapped IPv6 as IPv4", () => {
    expect(getRateLimitSubject("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("uses unknown when the raw IP is absent or invalid", () => {
    expect(getRateLimitSubject(null)).toBe("unknown");
    expect(getRateLimitSubject("not-an-ip")).toBe("unknown");
  });
});
