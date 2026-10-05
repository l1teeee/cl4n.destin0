import { describe, expect, it } from "vitest";

import { parseDatabaseEnv } from "@/infrastructure/config/database-env";
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

const validProductionEnvironment: Record<string, string | undefined> = {
  ...validEnvironment,
  APP_ENV: "production",
  DATABASE_URL: "postgres://app:secret@database.example.com:5432/cl4n",
  DATABASE_SSL_MODE: "verify-ca",
  DATABASE_CA_CERT: "test-ca-certificate",
  APP_SECRET: "production-secret-with-at-least-32-characters",
  TURNSTILE_SECRET_KEY: "0x4AAAAAA-valid-production-secret",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAA-valid-production-site-key",
  TURNSTILE_ALLOWED_HOSTNAMES: "clandestino.example.com",
};

describe("parseDatabaseEnv", () => {
  it("parses only the database variables without requiring the app environment", () => {
    expect(
      parseDatabaseEnv({
        DATABASE_URL: validEnvironment.DATABASE_URL,
        DATABASE_SSL_MODE: validEnvironment.DATABASE_SSL_MODE,
      }),
    ).toEqual({
      DATABASE_URL: validEnvironment.DATABASE_URL,
      DATABASE_SSL_MODE: "disable",
    });
  });
});

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

  it("accepts a protected environment with remote TLS and non-test credentials", () => {
    expect(parseServerEnv(validProductionEnvironment)).toMatchObject({
      APP_ENV: "production",
      DATABASE_SSL_MODE: "verify-ca",
    });
  });

  it.each([
    ["production", "production"],
    ["preview", "preview"],
  ] as const)("accepts APP_ENV=%s when VERCEL_ENV=%s", (appEnvironment, vercelEnvironment) => {
    expect(
      parseServerEnv({
        ...validProductionEnvironment,
        APP_ENV: appEnvironment,
        VERCEL_ENV: vercelEnvironment,
      }).APP_ENV,
    ).toBe(appEnvironment);
  });

  it("maps VERCEL_ENV=development to APP_ENV=local", () => {
    expect(parseServerEnv({ ...validEnvironment, VERCEL_ENV: "development" }).APP_ENV).toBe(
      "local",
    );
  });

  it.each([
    ["production", "preview"],
    ["preview", "production"],
    ["development", "test"],
  ] as const)("rejects VERCEL_ENV=%s with APP_ENV=%s", (vercelEnvironment, appEnvironment) => {
    const base =
      vercelEnvironment === "development" ? validEnvironment : validProductionEnvironment;
    expect(() =>
      parseServerEnv({
        ...base,
        APP_ENV: appEnvironment,
        VERCEL_ENV: vercelEnvironment,
      }),
    ).toThrow(/APP_ENV[\s\S]*VERCEL_ENV/);
  });

  it.each(["ssl", "sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"])(
    "rejects the DATABASE_URL TLS query parameter %s",
    (parameter) => {
      expect(() =>
        parseServerEnv({
          ...validEnvironment,
          DATABASE_URL: `${validEnvironment.DATABASE_URL}?${parameter}=require`,
        }),
      ).toThrow(new RegExp(`DATABASE_URL[\\s\\S]*${parameter}`));
    },
  );

  it("rejects DATABASE_URL TLS query parameter names case-insensitively", () => {
    expect(() =>
      parseServerEnv({
        ...validEnvironment,
        DATABASE_URL: `${validEnvironment.DATABASE_URL}?SslMode=require`,
      }),
    ).toThrow(/DATABASE_URL[\s\S]*sslmode/);
  });

  it("rejects local-only application secrets in protected environments", () => {
    expect(() =>
      parseServerEnv({
        ...validProductionEnvironment,
        APP_SECRET: "local-only-secret-that-is-long-enough-for-production",
      }),
    ).toThrow(/APP_SECRET[\s\S]*local-only/);
  });

  it("rejects application secrets shorter than 32 characters", () => {
    expect(() =>
      parseServerEnv({ ...validProductionEnvironment, APP_SECRET: "short-secret" }),
    ).toThrow(/APP_SECRET[\s\S]*32/);
  });

  it("rejects disabled database TLS in protected environments", () => {
    expect(() =>
      parseServerEnv({ ...validProductionEnvironment, DATABASE_SSL_MODE: "disable" }),
    ).toThrow(/DATABASE_SSL_MODE[\s\S]*disabled/);
  });

  it("rejects a localhost database URL in protected environments", () => {
    expect(() =>
      parseServerEnv({
        ...validProductionEnvironment,
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54329/cl4n",
      }),
    ).toThrow(/DATABASE_URL[\s\S]*local host/);
  });

  it.each([
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "2x00000000000000000000AB"],
    ["TURNSTILE_SECRET_KEY", "3x0000000000000000000000000000000AA"],
  ] as const)("rejects Cloudflare test credentials in %s", (name, value) => {
    expect(() => parseServerEnv({ ...validProductionEnvironment, [name]: value })).toThrow(
      new RegExp(`${name}[\\s\\S]*test key`),
    );
  });

  it("rejects localhost in protected Turnstile hostnames", () => {
    expect(() =>
      parseServerEnv({
        ...validProductionEnvironment,
        TURNSTILE_ALLOWED_HOSTNAMES: "clandestino.example.com,localhost",
      }),
    ).toThrow(/TURNSTILE_ALLOWED_HOSTNAMES[\s\S]*localhost/);
  });
});
