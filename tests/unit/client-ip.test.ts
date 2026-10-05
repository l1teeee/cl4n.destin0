import { describe, expect, it } from "vitest";

import { getClientIp } from "@/infrastructure/http/client-ip";

describe("getClientIp", () => {
  it("uses the first Vercel-forwarded IPv4 address", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(getClientIp(headers, "production")).toBe("203.0.113.9");
  });

  it("collapses IPv6 addresses to a /64 prefix", () => {
    const headers = new Headers({ "x-forwarded-for": "2001:0db8:abcd:0012:1234:5678:9abc:def0" });
    expect(getClientIp(headers, "preview")).toBe("2001:db8:abcd:12::/64");
  });

  it.each(["local", "test"] as const)("returns local in %s", (environment) => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    expect(getClientIp(headers, environment)).toBe("local");
  });

  it.each(["", "not-an-ip", "999.999.999.999", "garbage, 203.0.113.9"])(
    "returns unknown for garbage protected-environment input %j",
    (header) => {
      expect(getClientIp(new Headers({ "x-forwarded-for": header }), "production")).toBe("unknown");
    },
  );
});
