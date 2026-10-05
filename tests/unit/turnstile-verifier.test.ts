import { describe, expect, it, vi } from "vitest";

import {
  DisabledBotVerifier,
  TurnstileVerifier,
} from "@/infrastructure/bot-protection/turnstile-verifier";

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

function verifier(response: unknown, fetchMock = vi.fn<typeof fetch>()) {
  fetchMock.mockResolvedValue(jsonResponse(response));
  return {
    fetchMock,
    verifier: new TurnstileVerifier({
      secret: "secret",
      allowedHostnames: ["clandestino.example"],
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
    const { verifier: turnstile } = verifier(response);
    await expect(turnstile.verify(request)).resolves.toEqual({ ok: false, reason: "MISMATCH" });
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
      fetch: fetchMock,
    });
    await expect(turnstile.verify(request)).resolves.toEqual({ ok: false, reason: "UNAVAILABLE" });
  });

  it("sends the idempotency key and remote IP", async () => {
    const { verifier: turnstile, fetchMock } = verifier(successResponse);
    await turnstile.verify(request);

    const init = fetchMock.mock.calls[0]?.[1];
    const body = init?.body as URLSearchParams;
    expect(body.get("idempotency_key")).toBe(request.idempotencyKey);
    expect(body.get("remoteip")).toBe(request.remoteIp);
    expect(body.get("response")).toBe(request.token);
    expect(body.get("secret")).toBe("secret");
  });

  it("omits remoteip for local requests", async () => {
    const { verifier: turnstile, fetchMock } = verifier(successResponse);
    await turnstile.verify({ ...request, remoteIp: "local" });

    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has("remoteip")).toBe(false);
  });
});

describe("DisabledBotVerifier", () => {
  it("always allows the request", async () => {
    await expect(new DisabledBotVerifier().verify()).resolves.toEqual({ ok: true });
  });
});
