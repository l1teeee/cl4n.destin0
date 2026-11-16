import { afterEach, describe, expect, it, vi } from "vitest";

import { InstagramOAuthError } from "@/application/messaging/instagram-connection";
import { GraphUnifiedLoginClient } from "@/infrastructure/instagram/graph-unified-login-client";

const options = {
  appId: "12345",
  appSecret: "private-app-secret",
  configId: "67890",
  redirectUri: "https://example.com/api/instagram/callback",
  graphBaseUrl: "https://graph.facebook.com/v27.0",
};
const token = "private-system-token";

function mockResponse(body: unknown) {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
  vi.stubGlobal("fetch", request);
  return request;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GraphUnifiedLoginClient", () => {
  it("builds the exact Facebook Login for Business URL", () => {
    expect(new GraphUnifiedLoginClient(options).authorizationUrl("state+value")).toBe(
      "https://www.facebook.com/dialog/oauth?client_id=12345&config_id=67890&redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Finstagram%2Fcallback&response_type=code&override_default_response_type=true&state=state%2Bvalue&prompt=login",
    );
  });

  it("exchanges the code with the Meta app credentials", async () => {
    const request = mockResponse({ access_token: token });
    await expect(new GraphUnifiedLoginClient(options).exchangeCode("private+code")).resolves.toBe(
      token,
    );
    expect(request).toHaveBeenCalledWith(
      `${options.graphBaseUrl}/oauth/access_token?client_id=12345&client_secret=private-app-secret&redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Finstagram%2Fcallback&code=private%2Bcode`,
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it.each([{}, { access_token: "" }, { access_token: 123 }])(
    "rejects invalid token response %j",
    async (body) => {
      mockResponse(body);
      await expect(
        new GraphUnifiedLoginClient(options).exchangeCode("private-code"),
      ).rejects.toThrow("Invalid token response");
    },
  );

  it.each([
    [0, null],
    [1_800_000_000, new Date(1_800_000_000_000)],
  ])("inspects expiry %i", async (expiresAt, expected) => {
    const scopes = ["instagram_basic", "instagram_manage_messages"];
    const request = mockResponse({
      data: { is_valid: true, app_id: options.appId, scopes, expires_at: expiresAt },
    });
    await expect(new GraphUnifiedLoginClient(options).inspectToken(token)).resolves.toEqual({
      scopes,
      expiresAt: expected,
    });
    expect(request.mock.calls[0]![0]).toBe(
      `${options.graphBaseUrl}/debug_token?input_token=${token}&access_token=12345%7Cprivate-app-secret`,
    );
  });

  it.each([
    { app_id: "another-app" },
    { is_valid: false },
    { scopes: undefined },
    { scopes: [123] },
    { expires_at: -1 },
    { expires_at: "0" },
    { expires_at: undefined },
  ])("rejects invalid inspection %j", async (invalid) => {
    mockResponse({
      data: { is_valid: true, app_id: options.appId, scopes: [], expires_at: 0, ...invalid },
    });
    await expect(new GraphUnifiedLoginClient(options).inspectToken(token)).rejects.toThrow(
      "Invalid token inspection",
    );
  });

  it("accepts a numeric app id and rejects nonfinite expiry values", async () => {
    const request = mockResponse({
      data: { is_valid: true, app_id: 12345, scopes: [], expires_at: 0 },
    });
    const client = new GraphUnifiedLoginClient(options);
    await expect(client.inspectToken(token)).resolves.toEqual({ scopes: [], expiresAt: null });
    request.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { is_valid: true, app_id: options.appId, scopes: [], expires_at: Infinity },
      }),
    } as Response);
    await expect(client.inspectToken(token)).rejects.toThrow("Invalid token inspection");
  });

  it("lists assigned accounts with a bearer token", async () => {
    const request = mockResponse({ data: [{ id: "123456", username: "clandestino.sv" }] });
    await expect(new GraphUnifiedLoginClient(options).listAccounts(token)).resolves.toEqual([
      { accountId: "123456", username: "clandestino.sv" },
    ]);
    expect(request).toHaveBeenCalledWith(
      `${options.graphBaseUrl}/me/assigned_instagram_accounts?fields=id,username`,
      expect.objectContaining({ headers: { authorization: `Bearer ${token}` } }),
    );
  });

  it.each([
    {},
    { data: [{ id: "invalid", username: "account" }] },
    { data: [{ id: 123, username: "account" }] },
    { data: [{ id: "123", username: "" }] },
  ])("rejects invalid accounts %j", async (body) => {
    mockResponse(body);
    await expect(new GraphUnifiedLoginClient(options).listAccounts(token)).rejects.toThrow(
      "Invalid Instagram accounts response",
    );
  });

  it("subscribes only to fields supported by unified login", async () => {
    const request = mockResponse({ success: true });
    await expect(
      new GraphUnifiedLoginClient(options).subscribeWebhooks(token, "123456"),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      `${options.graphBaseUrl}/123456/subscribed_apps?subscribed_fields=messages%2Cmessaging_seen%2Cmessaging_referral%2Cmessage_reactions%2Cmessaging_postbacks`,
      expect.objectContaining({ method: "POST", headers: { authorization: `Bearer ${token}` } }),
    );
  });

  it("rejects a failed subscription", async () => {
    mockResponse({ success: false });
    await expect(
      new GraphUnifiedLoginClient(options).subscribeWebhooks(token, "123456"),
    ).rejects.toThrow("Instagram subscription failed");
  });

  it.each(["network", "http", "json", "non-object"])("redacts %s failures", async (failure) => {
    const request = vi.fn<typeof fetch>();
    if (failure === "network") {
      request.mockRejectedValue(new Error(`${options.graphBaseUrl} ${token} ${options.appSecret}`));
    } else if (failure === "http") {
      request.mockResolvedValue(
        Response.json({ error: `${token} ${options.appSecret}` }, { status: 400 }),
      );
    } else if (failure === "json") {
      request.mockResolvedValue(new Response(`${token} ${options.appSecret}`));
    } else {
      request.mockResolvedValue(Response.json([]));
    }
    vi.stubGlobal("fetch", request);
    const error = await new GraphUnifiedLoginClient(options)
      .inspectToken(token)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(InstagramOAuthError);
    expect((error as Error).message).toBe(
      failure === "non-object" ? "Invalid Instagram response" : "Instagram request failed",
    );
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain(options.appSecret);
    expect(String(error)).not.toContain(options.graphBaseUrl);
  });
});
