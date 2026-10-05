import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/infrastructure/config/env";

const validEnvironment: Record<string, string | undefined> = {
  APP_ENV: "local",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54329/cl4n_dev",
  DATABASE_SSL_MODE: "disable",
  DATABASE_POOL_MAX: "10",
  APP_SECRET: "a-local-secret-that-is-at-least-32-characters",
  BOT_PROTECTION_MODE: "turnstile",
  TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
  TURNSTILE_ALLOWED_HOSTNAMES: "localhost,127.0.0.1",
  RATE_LIMIT_MODE: "enforce",
};

describe("parseServerEnv", () => {
  it("parses valid local configuration", () => {
    const parsed = parseServerEnv(validEnvironment);

    expect(parsed.APP_ENV).toBe("local");
    expect(parsed.DATABASE_POOL_MAX).toBe(10);
    expect(parsed.TURNSTILE_ALLOWED_HOSTNAMES).toEqual(["localhost", "127.0.0.1"]);
  });

  it.each(["preview", "production"] as const)(
    "rejects disabled protections in %s",
    (appEnvironment) => {
      expect(() =>
        parseServerEnv({
          ...validEnvironment,
          APP_ENV: appEnvironment,
          BOT_PROTECTION_MODE: "disabled",
          RATE_LIMIT_MODE: "disabled",
        }),
      ).toThrow(/BOT_PROTECTION_MODE[\s\S]*RATE_LIMIT_MODE/);
    },
  );

  it("lists missing required variables", () => {
    expect(() => parseServerEnv({ APP_ENV: "local" })).toThrow(
      /DATABASE_URL[\s\S]*APP_SECRET[\s\S]*BOT_PROTECTION_MODE[\s\S]*TURNSTILE_ALLOWED_HOSTNAMES[\s\S]*RATE_LIMIT_MODE/,
    );
  });
});
