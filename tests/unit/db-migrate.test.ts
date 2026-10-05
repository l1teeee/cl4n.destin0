import { describe, expect, it } from "vitest";

import { validateMigrationTarget } from "../../scripts/db-migrate";

describe("validateMigrationTarget", () => {
  it("rejects disabled TLS for a remote database", () => {
    expect(() =>
      validateMigrationTarget({
        DATABASE_URL: "postgres://app:secret@database.example.com:5432/cl4n",
        DATABASE_SSL_MODE: "disable",
      }),
    ).toThrow(/DATABASE_SSL_MODE=disable[\s\S]*local/);
  });

  it("allows disabled TLS for a local database", () => {
    expect(() =>
      validateMigrationTarget({
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54329/cl4n_dev",
        DATABASE_SSL_MODE: "disable",
      }),
    ).not.toThrow();
  });
});
