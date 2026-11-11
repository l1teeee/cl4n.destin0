import { afterEach, describe, expect, it, vi } from "vitest";

describe("security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(["preview", "production"])("pins the %s headers", async (environment) => {
    vi.stubEnv("APP_ENV", environment);
    const { default: config } = await import("../../next.config");
    const rules = await config.headers!();
    const global = rules.find((rule) => rule.source === "/:path*");
    const reset = rules.find((rule) => rule.source === "/admin/reset");
    const headers = Object.fromEntries(global!.headers.map(({ key, value }) => [key, value]));
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
    expect(
      Number(headers["Strict-Transport-Security"]?.match(/max-age=(\d+)/)?.[1]),
    ).toBeGreaterThanOrEqual(31536000);
    expect(headers["Strict-Transport-Security"]).toContain("includeSubDomains");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(reset?.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
  });
});
