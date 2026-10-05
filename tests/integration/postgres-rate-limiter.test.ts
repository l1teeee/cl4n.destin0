import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { consume as ConsumeRateLimit } from "@/infrastructure/rate-limit/postgres-rate-limiter";

import { resetTestDatabase } from "../helpers/test-db";

let consume: typeof ConsumeRateLimit;
let applicationPool: Pool;

beforeAll(async () => {
  await resetTestDatabase();
  const limiter = await import("@/infrastructure/rate-limit/postgres-rate-limiter");
  const database = await import("@/infrastructure/db/client");
  consume = limiter.consume;
  applicationPool = database.pool;
});

beforeEach(async () => {
  await applicationPool.query("DELETE FROM rate_limit_counters");
});

afterAll(async () => {
  await applicationPool.end();
});

describe("PostgreSQL rate limiter", () => {
  it("allows exactly the configured limit and then blocks", async () => {
    const input = {
      scope: `exact-limit:${randomUUID()}`,
      subject: "same-subject",
      limit: 3,
      windowSeconds: 3600,
    };

    const results = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      results.push(await consume(input));
    }

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("allows exactly 50 of 200 concurrent calls for one subject", async () => {
    const input = {
      scope: `concurrency:${randomUUID()}`,
      subject: "same-subject",
      limit: 50,
      windowSeconds: 3600,
    };

    const results = await Promise.all(Array.from({ length: 200 }, () => consume(input)));
    const allowed = results.filter((result) => result.allowed);
    const blocked = results.filter((result) => !result.allowed);

    expect(allowed).toHaveLength(50);
    expect(blocked).toHaveLength(150);
    expect(blocked.every((result) => result.retryAfterSeconds > 0)).toBe(true);
  });

  it("tracks different subjects independently", async () => {
    const scope = `independent:${randomUUID()}`;
    const definition = { scope, limit: 1, windowSeconds: 3600 };

    const firstSubjectInitial = await consume({ ...definition, subject: "first" });
    const firstSubjectRepeated = await consume({ ...definition, subject: "first" });
    const secondSubjectInitial = await consume({ ...definition, subject: "second" });

    expect(firstSubjectInitial.allowed).toBe(true);
    expect(firstSubjectRepeated.allowed).toBe(false);
    expect(secondSubjectInitial.allowed).toBe(true);
  });

  it("always allows requests when disabled", async () => {
    const previousMode = process.env.RATE_LIMIT_MODE;
    process.env.RATE_LIMIT_MODE = "disabled";
    vi.resetModules();

    const disabledLimiter = await import("@/infrastructure/rate-limit/postgres-rate-limiter");
    const disabledDatabase = await import("@/infrastructure/db/client");

    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          disabledLimiter.consume({
            scope: "disabled",
            subject: "same-subject",
            limit: 1,
            windowSeconds: 60,
          }),
        ),
      );

      expect(results.every((result) => result.allowed)).toBe(true);
      expect(results.every((result) => result.retryAfterSeconds === 0)).toBe(true);
    } finally {
      await disabledDatabase.pool.end();
      process.env.RATE_LIMIT_MODE = previousMode;
      vi.resetModules();
    }
  });
});
