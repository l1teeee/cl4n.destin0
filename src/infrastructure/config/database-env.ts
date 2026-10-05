import type { PoolConfig } from "pg";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const forbiddenTlsParameters = new Set([
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "uselibpqcompat",
]);

export const databaseEnvFields = {
  DATABASE_URL: z
    .url()
    .refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol), {
      message: "must use the postgres or postgresql protocol",
    }),
  DATABASE_SSL_MODE: z.enum(["disable", "require-no-verify", "verify-ca"]).default("disable"),
  DATABASE_CA_CERT: optionalString,
};

interface DatabaseConfiguration {
  DATABASE_URL: string;
  DATABASE_SSL_MODE: "disable" | "require-no-verify" | "verify-ca";
  DATABASE_CA_CERT?: string;
}

export function validateDatabaseConfiguration(
  value: DatabaseConfiguration,
  context: z.RefinementCtx,
): void {
  const forbiddenParameters = [...new URL(value.DATABASE_URL).searchParams.keys()]
    .map((parameter) => parameter.toLowerCase())
    .filter((parameter) => forbiddenTlsParameters.has(parameter));

  if (forbiddenParameters.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: `cannot contain TLS query parameters: ${[...new Set(forbiddenParameters)].join(", ")}`,
    });
  }

  if (value.DATABASE_SSL_MODE === "verify-ca" && !value.DATABASE_CA_CERT) {
    context.addIssue({
      code: "custom",
      path: ["DATABASE_CA_CERT"],
      message: "is required when DATABASE_SSL_MODE is verify-ca",
    });
  }
}

const databaseEnvSchema = z.object(databaseEnvFields).superRefine(validateDatabaseConfiguration);

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;

export function parseDatabaseEnv(input: Record<string, string | undefined>): DatabaseEnv {
  const result = databaseEnvSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid database environment:\n${details}`);
  }

  return result.data;
}

export function databaseSsl(environment: DatabaseEnv): PoolConfig["ssl"] {
  if (environment.DATABASE_SSL_MODE === "disable") {
    return false;
  }

  if (environment.DATABASE_SSL_MODE === "require-no-verify") {
    return { rejectUnauthorized: false };
  }

  return {
    ca: environment.DATABASE_CA_CERT,
    checkServerIdentity: () => undefined,
  };
}

export function isLocalDatabaseHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase());
}
