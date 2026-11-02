import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  complete: vi.fn(),
  authorizationUrl: vi.fn(
    (state: string) => `https://www.instagram.com/oauth/authorize?state=${state}`,
  ),
  cookie: "state-value" as string | undefined,
  env: { MESSAGING_MODE: "instagram", APP_BASE_URL: "https://clandestino.example.com" },
  log: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (mocks.cookie === undefined ? undefined : { value: mocks.cookie }),
  })),
}));
vi.mock("@/infrastructure/auth/require-admin", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/infrastructure/config/env", () => ({ env: mocks.env }));
vi.mock("@/infrastructure/instagram/instagram-connection-runtime", () => ({
  instagramAuthorizationUrl: mocks.authorizationUrl,
  completeConfiguredInstagramConnection: mocks.complete,
}));
vi.mock("@/infrastructure/observability/logger", () => ({ log: mocks.log }));

const { GET: connect } = await import("@/app/api/instagram/connect/route");
const { GET: callback } = await import("@/app/api/instagram/callback/route");
const adminId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePermission.mockResolvedValue({
    authorized: true,
    session: { admin: { id: adminId, role: "SUPER_ADMIN" } },
  });
  mocks.complete.mockResolvedValue({ ok: true, username: "clandestino.sv" });
  mocks.cookie = "state-value";
  mocks.env.MESSAGING_MODE = "instagram";
  mocks.env.APP_BASE_URL = "https://clandestino.example.com";
});

function callbackRequest(query = "state=state-value&code=private-code"): Request {
  return new Request(`https://clandestino.example.com/api/instagram/callback?${query}`);
}

function expectCallback(response: Response, notice: string) {
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    `https://clandestino.example.com/admin/account?instagram=${notice}`,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toContain("cl4n_ig_oauth_state=;");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(response.headers.get("set-cookie")).toContain("Path=/api/instagram/callback");
}

describe("Instagram OAuth routes", () => {
  it("sets a secure state cookie and redirects to Instagram with that state", async () => {
    const response = await connect();
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const url = new URL(response.headers.get("location")!);
    expect(url.hostname).toBe("www.instagram.com");
    const state = url.searchParams.get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.authorizationUrl).toHaveBeenCalledWith(state);
    const cookie = response.headers.get("set-cookie")!;
    for (const part of [
      `cl4n_ig_oauth_state=${state}`,
      "HttpOnly",
      "Secure",
      "SameSite=lax",
      "Path=/api/instagram/callback",
      "Max-Age=600",
    ])
      expect(cookie).toContain(part);
    expect(mocks.requirePermission).toHaveBeenCalledWith("instagram.connect", "action");
  });

  it("allows the state cookie over local HTTP", async () => {
    mocks.env.APP_BASE_URL = "http://localhost:3000";
    expect((await connect()).headers.get("set-cookie")).not.toContain("Secure");
  });

  it.each([
    ["code=private-code", "state-value"],
    ["state=state-value&code=private-code", undefined],
    ["state=other-value&code=private-code", "state-value"],
    ["state=short&code=private-code", "state-value"],
  ])("rejects invalid state %s and clears the cookie", async (query, cookie) => {
    mocks.cookie = cookie;
    expectCallback(await callback(callbackRequest(query)), "invalid_state");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("checks state before processing cancellation", async () => {
    expectCallback(await callback(callbackRequest("error=access_denied")), "invalid_state");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([
    ["state=state-value&error=access_denied", "cancelled"],
    ["state=state-value", "failed"],
  ])("handles %s", async (query, notice) => {
    expectCallback(await callback(callbackRequest(query)), notice);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("completes a connection for the authenticated super admin", async () => {
    expectCallback(await callback(callbackRequest()), "connected");
    expect(mocks.complete).toHaveBeenCalledWith("private-code", adminId);
    expect(mocks.log).toHaveBeenCalledWith("info", "instagram_connected", {
      username: "clandestino.sv",
    });
  });

  it.each([
    ["TOKEN_EXCHANGE_FAILED", "failed"],
    ["MISSING_PERMISSION", "missing_permission"],
    ["WRONG_ACCOUNT", "wrong_account"],
    ["SUBSCRIBE_FAILED", "subscribe_failed"],
  ])("maps %s without logging the code", async (reason, notice) => {
    mocks.complete.mockResolvedValue({ ok: false, error: reason });
    expectCallback(await callback(callbackRequest()), notice);
    expect(mocks.log).toHaveBeenCalledWith("warn", "instagram_connect_failed", { reason });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private-code");
  });

  it.each(["connect", "callback"])("rejects ADMIN on %s", async (route) => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "FORBIDDEN" });
    const response = route === "connect" ? await connect() : await callback(callbackRequest());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://clandestino.example.com/admin/account?instagram=forbidden",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (route === "callback") expectCallback(response, "forbidden");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.authorizationUrl).not.toHaveBeenCalled();
  });

  it.each(["connect", "callback"])("requires a session on %s", async (route) => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "UNAUTHORIZED" });
    const response = route === "connect" ? await connect() : await callback(callbackRequest());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://clandestino.example.com/admin/login");
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (route === "callback") expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each(["connect", "callback"])("returns an uncached 404 for %s in log mode", async (route) => {
    mocks.env.MESSAGING_MODE = "log";
    const response = route === "connect" ? await connect() : await callback(callbackRequest());
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    if (route === "callback") expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.authorizationUrl).not.toHaveBeenCalled();
  });
});
