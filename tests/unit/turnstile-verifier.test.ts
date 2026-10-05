import { describe, expect, it, vi } from "vitest";

import {
  createBotVerifier,
  DisabledBotVerifier,
  TurnstileVerifier,
} from "@/infrastructure/bot-protection/turnstile-verifier";
import { env } from "@/infrastructure/config/env";

const request = {
  token: "turnstile-token",
  remoteIp: "203.0.113.9",
  idempotencyKey: "3f999fea-7e9a-44cf-84d2-7cb40eeff16e",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function verifier(
  response: unknown,
  acceptTestingKeyResults = false,
  fetchMock = vi.fn<typeof fetch>(),
) {
  fetchMock.mockResolvedValue(jsonResponse(response));
  return {
    fetchMock,
    verifier: new TurnstileVerifier({
      secret: "secret",
      allowedHostnames: ["clandestino.example"],
      acceptTestingKeyResults,
      fetch: fetchMock,
    }),
  };
}

const successResponse = {
  success: true,
  action: "reserve",
  hostname: "clandestino.example",
  cdata: request.idempotencyKey,
};

describe("TurnstileVerifier", () => {
  it("accepts a response bound to the reservation request", async () => {
    const { verifier: turnstile } = verifier(successResponse);
    await expect(turnstile.verify(request)).resolves.toEqual({ ok: true });
  });

  it.each([
    ["wrong action", { ...successResponse, action: "login" }],
    ["wrong hostname", { ...successResponse, hostname: "evil.example" }],
    ["cdata mismatch", { ...successResponse, cdata: "another-key" }],
  ])("returns MISMATCH for %s", async (_case, response) => {
    const { verifier: turnstile } = verifier(response, true);
    await expect(turnstile.verify(request)).resolves.toEqual({ ok: false, reason: "MISMATCH" });
  });

  it("accepts a testing-key result when explicitly allowed", async () => {
    const { verifier: turnstile } = verifier(
      {
        success: true,
        hostname: "example.com",
        metadata: { result_with_testing_key: true },
      },
      true,
    );

    await expect(turnstile.verify(request)).resolves.toEqual({ ok: true });
  });

  it("rejects a testing-key result when not allowed", async () => {
    const { verifier: turnstile } = verifier({
      success: true,
      hostname: "example.com",
      metadata: { result_with_testing_key: true },
    });

    await expect(turnstile.verify(request)).resolves.toEqual({ ok: false, reason: "INVALID" });
  });

  it("classifies timeout-or-duplicate separately", async () => {
    const { verifier: turnstile } = verifier({
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    });
    await expect(turnstile.verify(request)).resolves.toEqual({
      ok: false,
      reason: "TOKEN_EXPIRED_OR_SPENT",
    });
  });

  it("fails closed on a network error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    const turnstile = new TurnstileVerifier({
      secret: "secret",
      allowedHostnames: ["clandestino.example"],
      acceptTestingKeyResults: false,
      fetch: fetchMock,
    });
    await expect(turnstile.verify(request)).resolves.toEqual({ ok: false, reason: "UNAVAILABLE" });
  });

  it("fails closed when verification times out", async () => {
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const turnstile = new TurnstileVerifier({
      secret: "secret",
      allowedHostnames: ["clandestino.example"],
      acceptTestingKeyResults: false,
      fetch: fetchMock,
      timeoutMs: 5,
    });
    await expect(turnstile.verify(request)).resolves.toEqual({ ok: false, reason: "UNAVAILABLE" });
  });

  it("fails closed on a non-200 response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 503));
    const turnstile = new TurnstileVerifier({
      secret: "secret",
      allowedHostnames: ["clandestino.example"],
      acceptTestingKeyResults: false,
      fetch: fetchMock,
    });
    await expect(turnstile.verify(request)).resolves.toEqual({ ok: false, reason: "UNAVAILABLE" });
  });

  it("sends the token and raw remote IP without an idempotency parameter", async () => {
    const { verifier: turnstile, fetchMock } = verifier(successResponse);
    await turnstile.verify(request);

    const init = fetchMock.mock.calls[0]?.[1];
    const body = init?.body as URLSearchParams;
    expect(body.has("idempotency_key")).toBe(false);
    expect(body.get("remoteip")).toBe(request.remoteIp);
    expect(body.get("response")).toBe(request.token);
    expect(body.get("secret")).toBe("secret");
  });

  it.each([null, "local"])("omits remoteip for %s requests", async (remoteIp) => {
    const { verifier: turnstile, fetchMock } = verifier(successResponse);
    await turnstile.verify({ ...request, remoteIp });

    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has("remoteip")).toBe(false);
  });
});

describe("createBotVerifier", () => {
  it.each([
    ["local", true],
    ["test", true],
    ["preview", false],
    ["production", false],
  ] as const)("sets testing-key acceptance for APP_ENV=%s", async (appEnvironment, accepted) => {
    const originalAppEnvironment = env.APP_ENV;
    const originalBotProtectionMode = env.BOT_PROTECTION_MODE;
    env.APP_ENV = appEnvironment;
    env.BOT_PROTECTION_MODE = "turnstile";

    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          success: true,
          hostname: "example.com",
          metadata: { result_with_testing_key: true },
        }),
      );
      const turnstile = createBotVerifier(fetchMock);

      await expect(turnstile.verify(request)).resolves.toEqual(
        accepted ? { ok: true } : { ok: false, reason: "INVALID" },
      );
    } finally {
      env.APP_ENV = originalAppEnvironment;
      env.BOT_PROTECTION_MODE = originalBotProtectionMode;
    }
  });
});

describe("DisabledBotVerifier", () => {
  it("always allows the request", async () => {
    await expect(new DisabledBotVerifier().verify()).resolves.toEqual({ ok: true });
  });
});
