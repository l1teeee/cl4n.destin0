import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "preview", "production"]),
    DATABASE_URL: z
      .url()
      .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), {
        message: "must use the postgres or postgresql protocol",
      }),
    DATABASE_SSL_MODE: z.enum(["disable", "require-no-verify", "verify-ca"]).default("disable"),
    DATABASE_CA_CERT: optionalString,
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    APP_SECRET: z.string().min(32),
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
    const protectedEnvironment = value.APP_ENV === "preview" || value.APP_ENV === "production";

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

    if (value.DATABASE_SSL_MODE === "verify-ca" && !value.DATABASE_CA_CERT) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_CA_CERT"],
        message: "is required when DATABASE_SSL_MODE is verify-ca",
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
