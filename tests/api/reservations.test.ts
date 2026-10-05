import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReservationAllocationRepository } from "@/application/ports/reservation-allocation-repository";
import { createReservationHandler } from "@/app/api/reservations/reservation-handler";
import { DELETE, GET, HEAD, OPTIONS, PATCH, PUT } from "@/app/api/reservations/route";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import type { PostgresReservationAllocationRepository as Repository } from "@/infrastructure/db/repositories/reservation-allocation-repository";

import { resetTestDatabase } from "../helpers/test-db";
import { insertTestEvent, reservationBody } from "../helpers/reservation-test-data";

let pool: Pool;
let repository: Repository;

beforeAll(async () => {
  await resetTestDatabase();
  const database = await import("@/infrastructure/db/client");
  const repositoryModule =
    await import("@/infrastructure/db/repositories/reservation-allocation-repository");
  pool = database.pool;
  repository = new repositoryModule.PostgresReservationAllocationRepository(pool);
});

afterAll(async () => {
  await pool.end();
});

const log = vi.fn();

beforeEach(() => {
  log.mockClear();
});

function request(body: unknown, key: string | null = randomUUID()): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) {
    headers.set("Idempotency-Key", key);
  }

  return new Request("http://localhost/api/reservations", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const rateLimiter = {
    consume: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  };
  const botVerifier = {
    verify: vi.fn(async () => ({ ok: true as const })),
  };
  const handler = createReservationHandler({
    repository,
    rateLimiter,
    botVerifier,
    computeFingerprint: requestFingerprint,
    observability: { log },
    ...overrides,
  });

  return { handler, rateLimiter, botVerifier };
}

describe("POST /api/reservations", () => {
  it.each([null, "text/plain", "application/x-www-form-urlencoded"])(
    "returns 415 for unsupported content type %s",
    async (contentType) => {
      const setup = dependencies();
      const headers = new Headers({ "Idempotency-Key": randomUUID() });
      if (contentType) headers.set("content-type", contentType);

      const response = await setup.handler(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers,
          body: "{}",
        }),
      );

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "UNSUPPORTED_MEDIA_TYPE" },
      });
      expect(setup.rateLimiter.consume).not.toHaveBeenCalled();
      expect(setup.botVerifier.verify).not.toHaveBeenCalled();
    },
  );

  it("returns 413 from content-length before parsing JSON", async () => {
    const setup = dependencies();
    const response = await setup.handler(
      new Request("http://localhost/api/reservations", {
        method: "POST",
        headers: {
          "content-length": String(16 * 1024 + 1),
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    expect(setup.rateLimiter.consume).not.toHaveBeenCalled();
    expect(setup.botVerifier.verify).not.toHaveBeenCalled();
  });

  it("returns 413 when the streamed body exceeds the limit despite a false header", async () => {
    const setup = dependencies();
    const response = await setup.handler(
      new Request("http://localhost/api/reservations", {
        method: "POST",
        headers: {
          "content-length": "2",
          "content-type": "application/json; charset=utf-8",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ value: "x".repeat(16 * 1024) }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    expect(setup.rateLimiter.consume).not.toHaveBeenCalled();
    expect(setup.botVerifier.verify).not.toHaveBeenCalled();
  });

  it("returns a byte-identical replay without rate-limit or bot work", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();
    const setup = dependencies();
    const body = reservationBody(event.slug, 100);

    const first = await setup.handler(request(body, key));
    const firstText = await first.text();
    const callsAfterFirst = {
      rate: setup.rateLimiter.consume.mock.calls.length,
      bot: setup.botVerifier.verify.mock.calls.length,
    };
    const replay = await setup.handler(request(body, key));
    const replayText = await replay.text();

    expect(first.status).toBe(201);
    expect(replay.status).toBe(first.status);
    expect(replayText).toBe(firstText);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(replay.headers.get("Cache-Control")).toBe("no-store");
    expect(setup.rateLimiter.consume).toHaveBeenCalledTimes(callsAfterFirst.rate);
    expect(setup.botVerifier.verify).toHaveBeenCalledTimes(callsAfterFirst.bot);
    const logOutput = JSON.stringify(log.mock.calls);
    expect(logOutput).not.toContain(String(body.fullName));
    expect(logOutput).not.toContain(String(body.instagram));
    expect(logOutput).not.toContain(String(body.phone));
    expect(logOutput).not.toContain(String(body.email));
    expect(logOutput).not.toContain(String(body.notes));

    const state = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM reservations WHERE event_id = $1) AS reservations,
         (SELECT reserved_seats FROM events WHERE id = $1) AS reserved_seats,
         (SELECT COUNT(*)::int FROM idempotency_records WHERE key = $2) AS records`,
      [event.id, key],
    );
    expect(state.rows[0]).toEqual({ reservations: 1, reserved_seats: 1, records: 1 });
  });

  it("rejects reuse of a completed key with a different payload", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();
    const setup = dependencies();
    await setup.handler(request(reservationBody(event.slug, 110), key));
    const before = await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id]);

    const response = await setup.handler(request(reservationBody(event.slug, 111), key));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });
    const after = await pool.query("SELECT reserved_seats FROM events WHERE id = $1", [event.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(setup.botVerifier.verify).toHaveBeenCalledTimes(1);
    expect(setup.rateLimiter.consume).toHaveBeenCalledTimes(3);
  });

  it.each([null, "not-a-uuid"])(
    "returns 400 for a missing or invalid idempotency key %#",
    async (key) => {
      const event = await insertTestEvent(pool);
      const setup = dependencies();
      const response = await setup.handler(request(reservationBody(event.slug, 120), key));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
      });
      expect(setup.rateLimiter.consume).not.toHaveBeenCalled();
      expect(setup.botVerifier.verify).not.toHaveBeenCalled();
    },
  );

  it.each(["capacity", "eventId", "status", "price"])(
    "rejects the forbidden client field %s",
    async (field) => {
      const event = await insertTestEvent(pool);
      const setup = dependencies();
      const response = await setup.handler(
        request({ ...reservationBody(event.slug, 130), [field]: "forbidden" }),
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_FAILED" },
      });
      const state = await pool.query(
        "SELECT COUNT(*)::int AS count FROM reservations WHERE event_id = $1",
        [event.id],
      );
      expect(state.rows[0]!.count).toBe(0);
    },
  );

  it("returns validation failure for invalid JSON", async () => {
    const setup = dependencies();
    const response = await setup.handler(
      new Request("http://localhost/api/reservations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        fields: { request: ["El cuerpo debe contener JSON válido."] },
      },
    });
  });

  it("checks Turnstile before consuming an email or phone limit", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();
    const rateLimiter = {
      consume: vi.fn(async ({ scope }: { scope: string }) => ({
        allowed: scope !== "reservation:email",
        retryAfterSeconds: scope === "reservation:email" ? 37 : 0,
      })),
    };
    const setup = dependencies({ rateLimiter });
    const response = await setup.handler(request(reservationBody(event.slug, 140), key));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("37");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(setup.botVerifier.verify).toHaveBeenCalledOnce();
    expect(rateLimiter.consume.mock.calls.map(([input]) => input.scope)).toEqual([
      "reservation:ip",
      "reservation:email",
      "reservation:phone",
    ]);
    const state = await pool.query(
      "SELECT COUNT(*)::int AS count FROM idempotency_records WHERE key = $1",
      [key],
    );
    expect(state.rows[0]!.count).toBe(0);
  });

  it("stops at the IP limit before Turnstile and identity limits", async () => {
    const event = await insertTestEvent(pool);
    const rateLimiter = {
      consume: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 19 })),
    };
    const setup = dependencies({ rateLimiter });

    const response = await setup.handler(request(reservationBody(event.slug, 145)));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("19");
    expect(rateLimiter.consume).toHaveBeenCalledOnce();
    expect(rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "reservation:ip", subject: "unknown" }),
    );
    expect(setup.botVerifier.verify).not.toHaveBeenCalled();
  });

  it("returns bot failure with the spent-token reason", async () => {
    const event = await insertTestEvent(pool);
    const key = randomUUID();
    const botVerifier = {
      verify: vi.fn(async () => ({
        ok: false as const,
        reason: "TOKEN_EXPIRED_OR_SPENT" as const,
      })),
    };
    const setup = dependencies({ botVerifier });
    const response = await setup.handler(request(reservationBody(event.slug, 150), key));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BOT_CHECK_FAILED", reason: "TOKEN_EXPIRED_OR_SPENT" },
    });
    expect(setup.rateLimiter.consume).toHaveBeenCalledOnce();
    expect(setup.rateLimiter.consume).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "reservation:ip" }),
    );
    const state = await pool.query(
      "SELECT COUNT(*)::int AS count FROM idempotency_records WHERE key = $1",
      [key],
    );
    expect(state.rows[0]!.count).toBe(0);
  });

  it.each(["replay lookup", "rate limiter"] as const)(
    "returns TRY_AGAIN when the %s times out waiting for a pool connection",
    async (failureSource) => {
      const poolTimeout = new Error("timeout exceeded when trying to connect");
      const failingRepository: ReservationAllocationRepository = {
        async findCompletedIdempotencyRecord() {
          if (failureSource === "replay lookup") throw poolTimeout;
          return null;
        },
        async allocate() {
          throw new Error("allocation should not run");
        },
        async cancelReservation() {
          return "NOT_FOUND";
        },
      };
      const rateLimiter = {
        consume: vi.fn(async () => {
          if (failureSource === "rate limiter") throw poolTimeout;
          return { allowed: true, retryAfterSeconds: 0 };
        }),
      };
      const captureException = vi.fn();
      const setup = dependencies({
        repository: failingRepository,
        rateLimiter,
        observability: { log, captureException },
      });

      const response = await setup.handler(request(reservationBody("pool-timeout-event", 155)));

      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("1");
      await expect(response.json()).resolves.toMatchObject({ error: { code: "TRY_AGAIN" } });
      expect(captureException).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        "warn",
        "reservation_submission_retryable",
        expect.objectContaining({ outcome: "TRY_AGAIN", code: "POOL_CONNECTION_TIMEOUT" }),
      );
    },
  );

  it("returns a sanitized 500, logs it and captures the exception", async () => {
    const event = await insertTestEvent(pool);
    const internalMessage = "relation secrets does not exist at SQL line 42";
    const failingRepository: ReservationAllocationRepository = {
      async findCompletedIdempotencyRecord() {
        return null;
      },
      async allocate() {
        throw new Error(internalMessage);
      },
      async cancelReservation() {
        return "NOT_FOUND";
      },
    };
    const captureException = vi.fn();
    const setup = dependencies({
      repository: failingRepository,
      observability: { log, captureException },
    });
    const response = await setup.handler(request(reservationBody(event.slug, 160)));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).toContain("requestId");
    expect(text).not.toContain(internalMessage);
    expect(captureException).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      "error",
      "reservation_submission_failed",
      expect.objectContaining({ outcome: "INTERNAL_ERROR" }),
    );
  });
});

describe("unsupported reservation methods", () => {
  it.each([GET, PUT, PATCH, DELETE, OPTIONS, HEAD])("returns 405", (handler) => {
    const response = handler();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
