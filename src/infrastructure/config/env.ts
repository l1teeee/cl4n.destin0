import { z } from "zod";

import { databaseEnvFields, validateDatabaseConfiguration } from "./database-env";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.email().optional(),
);

const turnstileTestKeyPrefixes = ["1x0000", "2x0000", "3x0000"];

function isTurnstileTestKey(value: string | undefined): boolean {
  return Boolean(value && turnstileTestKeyPrefixes.some((prefix) => value.startsWith(prefix)));
}

const serverEnvSchema = z
  .object({
    ...databaseEnvFields,
    APP_ENV: z.enum(["local", "test", "preview", "production"]),
    VERCEL: z.string().optional(),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    APP_SECRET: z.string().min(32),
    EMAIL_MODE: z.enum(["brevo", "log"]),
    BREVO_API_KEY: optionalString,
    EMAIL_FROM_ADDRESS: optionalEmail,
    EMAIL_FROM_NAME: z.string().trim().min(1).default("Clandestino"),
    APP_BASE_URL: z.url().transform((value) => value.replace(/\/$/, "")),
    BOT_PROTECTION_MODE: z.enum(["turnstile", "disabled"]),
    TURNSTILE_SECRET_KEY: optionalString,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,
    TURNSTILE_ALLOWED_HOSTNAMES: z.string().transform((value) =>
      value
        .split(",")
        .map((hostname) => hostname.trim())
        .filter(Boolean),
    ),
    RATE_LIMIT_MODE: z.enum(["enforce", "disabled"]),
    SENTRY_DSN: optionalString,
    NEXT_PUBLIC_SENTRY_DSN: optionalString,
  })
  .superRefine((value, context) => {
    validateDatabaseConfiguration(value, context);
    const protectedEnvironment = value.APP_ENV === "preview" || value.APP_ENV === "production";

    const expectedAppEnvironment = {
      production: "production",
      preview: "preview",
      development: "local",
    } as const;

    if (value.VERCEL !== undefined && !value.VERCEL_ENV) {
      context.addIssue({
        code: "custom",
        path: ["VERCEL_ENV"],
        message: "is required when VERCEL is set",
      });
    }

    if (value.VERCEL_ENV && value.APP_ENV !== expectedAppEnvironment[value.VERCEL_ENV]) {
      context.addIssue({
        code: "custom",
        path: ["APP_ENV"],
        message: `must be ${expectedAppEnvironment[value.VERCEL_ENV]} when VERCEL_ENV is ${value.VERCEL_ENV}`,
      });
    }

    if (protectedEnvironment && value.APP_SECRET.startsWith("local-only")) {
      context.addIssue({
        code: "custom",
        path: ["APP_SECRET"],
        message: "cannot use a local-only value in preview or production",
      });
    }

    if (protectedEnvironment && value.APP_SECRET.length < 32) {
      context.addIssue({
        code: "custom",
        path: ["APP_SECRET"],
        message: "must contain at least 32 characters in preview or production",
      });
    }

    if (protectedEnvironment && value.DATABASE_SSL_MODE === "disable") {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_SSL_MODE"],
        message: "cannot be disabled in preview or production",
      });
    }

    if (
      protectedEnvironment &&
      ["localhost", "127.0.0.1"].includes(new URL(value.DATABASE_URL).hostname)
    ) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "cannot point to a local host in preview or production",
      });
    }

    if (protectedEnvironment && isTurnstileTestKey(value.NEXT_PUBLIC_TURNSTILE_SITE_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
        message: "cannot use a Cloudflare test key in preview or production",
      });
    }

    if (protectedEnvironment && isTurnstileTestKey(value.TURNSTILE_SECRET_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["TURNSTILE_SECRET_KEY"],
        message: "cannot use a Cloudflare test key in preview or production",
      });
    }

    if (
      protectedEnvironment &&
      value.TURNSTILE_ALLOWED_HOSTNAMES.some((hostname) =>
        hostname.toLowerCase().includes("localhost"),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["TURNSTILE_ALLOWED_HOSTNAMES"],
        message: "cannot contain localhost in preview or production",
      });
    }

    if (protectedEnvironment && value.BOT_PROTECTION_MODE === "disabled") {
      context.addIssue({
        code: "custom",
        path: ["BOT_PROTECTION_MODE"],
        message: "cannot be disabled in preview or production",
      });
    }

    if (protectedEnvironment && value.RATE_LIMIT_MODE === "disabled") {
      context.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_MODE"],
        message: "cannot be disabled in preview or production",
      });
    }

    if (value.EMAIL_MODE === "brevo") {
      if (!value.BREVO_API_KEY) {
        context.addIssue({
          code: "custom",
          path: ["BREVO_API_KEY"],
          message: "is required when EMAIL_MODE is brevo",
        });
      }

      if (!value.EMAIL_FROM_ADDRESS) {
        context.addIssue({
          code: "custom",
          path: ["EMAIL_FROM_ADDRESS"],
          message: "is required when EMAIL_MODE is brevo",
        });
      }
    }

    if (protectedEnvironment && value.EMAIL_MODE !== "brevo") {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_MODE"],
        message: "must be brevo in preview or production",
      });
    }

    const appBaseUrl = new URL(value.APP_BASE_URL);

    if (protectedEnvironment && appBaseUrl.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "must use https in preview or production",
      });
    }

    if (protectedEnvironment && ["localhost", "127.0.0.1"].includes(appBaseUrl.hostname)) {
      context.addIssue({
        code: "custom",
        path: ["APP_BASE_URL"],
        message: "cannot use a local host in preview or production",
      });
    }

    if (value.BOT_PROTECTION_MODE === "turnstile") {
      if (!value.TURNSTILE_SECRET_KEY) {
        context.addIssue({
          code: "custom",
          path: ["TURNSTILE_SECRET_KEY"],
          message: "is required when BOT_PROTECTION_MODE is turnstile",
        });
      }

      if (!value.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
        context.addIssue({
          code: "custom",
          path: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
          message: "is required when BOT_PROTECTION_MODE is turnstile",
        });
      }

      if (value.TURNSTILE_ALLOWED_HOSTNAMES.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["TURNSTILE_ALLOWED_HOSTNAMES"],
          message: "must contain at least one hostname when BOT_PROTECTION_MODE is turnstile",
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${details}`);
  }

  return result.data;
}

export const env = parseServerEnv(process.env);

if (env.DATABASE_SSL_MODE === "require-no-verify") {
  console.warn(
    JSON.stringify({
      level: "warn",
      msg: "database_tls_certificate_verification_disabled",
    }),
  );
}
