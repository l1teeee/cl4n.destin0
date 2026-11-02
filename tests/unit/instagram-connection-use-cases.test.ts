import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InstagramOAuthError,
  type InstagramConnection,
} from "@/application/messaging/instagram-connection";
import {
  completeInstagramConnection,
  disconnectInstagram,
  refreshInstagramTokenIfDue,
} from "@/application/messaging/instagram-connection-use-cases";
import { GraphInstagramOAuthClient } from "@/infrastructure/instagram/graph-instagram-oauth-client";

const now = new Date("2026-11-01T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const input = { code: "private-code", adminId: "admin-id", requiredUsername: "Clandestino.SV" };

function dependencies() {
  return {
    oauth: {
      authorizationUrl: vi.fn(),
      exchangeCode: vi.fn(async () => ({
        shortLivedToken: "short-token",
        permissions: ["instagram_business_manage_messages"],
      })),
      exchangeLongLivedToken: vi.fn(async () => ({
        accessToken: "long-token",
        expiresInSeconds: 60 * 24 * 60 * 60,
      })),
      fetchAccount: vi.fn(async () => ({ accountId: "1234", username: "clandestino.sv" })),
      subscribeWebhooks: vi.fn(async () => undefined),
      refreshToken: vi.fn(async () => ({
        accessToken: "refreshed-token",
        expiresInSeconds: 60 * 24 * 60 * 60,
      })),
    },
    repository: {
      find: vi.fn<() => Promise<InstagramConnection | null>>(async () => null),
      save: vi.fn(async () => undefined),
      replaceToken: vi.fn(async () => true),
      delete: vi.fn(async () => true),
    },
    now: () => now,
  };
}

function connection(daysLeft: number): InstagramConnection {
  return {
    accountId: "1234",
    username: "clandestino.sv",
    accessToken: "current-token",
    tokenExpiresAt: new Date(now.getTime() + daysLeft * day),
    tokenVersion: 7,
    connectedAt: now,
    tokenRefreshedAt: now,
    connectedByAdminId: "admin-id",
  };
}

describe("completeInstagramConnection", () => {
  it("subscribes and saves the long-lived token with the correct expiry", async () => {
    const deps = dependencies();
    await expect(completeInstagramConnection(deps, input)).resolves.toEqual({
      ok: true,
      username: "clandestino.sv",
    });
    expect(deps.oauth.exchangeCode).toHaveBeenCalledWith(input.code);
    expect(deps.oauth.exchangeLongLivedToken).toHaveBeenCalledWith("short-token");
    expect(deps.oauth.fetchAccount).toHaveBeenCalledWith("long-token");
    expect(deps.oauth.subscribeWebhooks).toHaveBeenCalledWith("long-token");
    expect(deps.repository.save).toHaveBeenCalledWith({
      accountId: "1234",
      username: "clandestino.sv",
      accessToken: "long-token",
      tokenExpiresAt: new Date(now.getTime() + 60 * day),
      adminId: input.adminId,
    });
    expect(deps.oauth.subscribeWebhooks.mock.invocationCallOrder[0]).toBeLessThan(
      deps.repository.save.mock.invocationCallOrder[0]!,
    );
  });

  it("accepts any username when no required username is configured", async () => {
    const deps = dependencies();
    await expect(
      completeInstagramConnection(deps, { ...input, requiredUsername: null }),
    ).resolves.toEqual({ ok: true, username: "clandestino.sv" });
  });

  it.each(["exchangeCode", "exchangeLongLivedToken", "fetchAccount"] as const)(
    "maps %s OAuth failures without saving",
    async (method) => {
      const deps = dependencies();
      deps.oauth[method].mockRejectedValue(new InstagramOAuthError("request failed"));
      await expect(completeInstagramConnection(deps, input)).resolves.toEqual({
        ok: false,
        error: "TOKEN_EXCHANGE_FAILED",
      });
      expect(deps.repository.save).not.toHaveBeenCalled();
      expect(deps.oauth.subscribeWebhooks).not.toHaveBeenCalled();
    },
  );

  it("checks permission before exchanging the long-lived token", async () => {
    const deps = dependencies();
    deps.oauth.exchangeCode.mockResolvedValue({
      shortLivedToken: "short-token",
      permissions: ["instagram_business_basic"],
    });
    await expect(completeInstagramConnection(deps, input)).resolves.toEqual({
      ok: false,
      error: "MISSING_PERMISSION",
    });
    expect(deps.oauth.exchangeLongLivedToken).not.toHaveBeenCalled();
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it("rejects a different account without subscribing or saving", async () => {
    const deps = dependencies();
    deps.oauth.fetchAccount.mockResolvedValue({ accountId: "5678", username: "someone.else" });
    await expect(completeInstagramConnection(deps, input)).resolves.toEqual({
      ok: false,
      error: "WRONG_ACCOUNT",
    });
    expect(deps.oauth.subscribeWebhooks).not.toHaveBeenCalled();
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it("maps subscription failures without saving", async () => {
    const deps = dependencies();
    deps.oauth.subscribeWebhooks.mockRejectedValue(new InstagramOAuthError("subscription failed"));
    await expect(completeInstagramConnection(deps, input)).resolves.toEqual({
      ok: false,
      error: "SUBSCRIBE_FAILED",
    });
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it.each(["exchangeCode", "exchangeLongLivedToken", "fetchAccount", "subscribeWebhooks"] as const)(
    "propagates unexpected %s errors without saving",
    async (method) => {
      const deps = dependencies();
      const error = new Error("unexpected failure");
      deps.oauth[method].mockRejectedValue(error);
      await expect(completeInstagramConnection(deps, input)).rejects.toBe(error);
      expect(deps.repository.save).not.toHaveBeenCalled();
    },
  );
});

describe("disconnectInstagram", () => {
  it("deletes for the actor and reports a missing connection", async () => {
    const deps = dependencies();
    await expect(disconnectInstagram(deps, input.adminId)).resolves.toEqual({ ok: true });
    expect(deps.repository.delete).toHaveBeenCalledWith(input.adminId);
    deps.repository.delete.mockResolvedValue(false);
    await expect(disconnectInstagram(deps, input.adminId)).resolves.toEqual({
      ok: false,
      error: "NOT_CONNECTED",
    });
  });
});

describe("refreshInstagramTokenIfDue", () => {
  it("returns NOT_CONNECTED without calling OAuth", async () => {
    const deps = dependencies();
    await expect(refreshInstagramTokenIfDue(deps)).resolves.toBe("NOT_CONNECTED");
    expect(deps.oauth.refreshToken).not.toHaveBeenCalled();
    expect(deps.repository.replaceToken).not.toHaveBeenCalled();
  });

  it("returns NOT_DUE with 31 days remaining", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue(connection(31));
    await expect(refreshInstagramTokenIfDue(deps)).resolves.toBe("NOT_DUE");
    expect(deps.oauth.refreshToken).not.toHaveBeenCalled();
  });

  it.each([29, 30])("refreshes with %i days remaining and fences the write", async (daysLeft) => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue(connection(daysLeft));
    await expect(refreshInstagramTokenIfDue(deps)).resolves.toBe("REFRESHED");
    expect(deps.oauth.refreshToken).toHaveBeenCalledWith("current-token");
    expect(deps.repository.replaceToken).toHaveBeenCalledWith({
      expectedVersion: 7,
      accessToken: "refreshed-token",
      tokenExpiresAt: new Date(now.getTime() + 60 * day),
    });
  });

  it("returns SUPERSEDED when another writer changes the version", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue(connection(29));
    deps.repository.replaceToken.mockResolvedValue(false);
    await expect(refreshInstagramTokenIfDue(deps)).resolves.toBe("SUPERSEDED");
  });

  it("propagates OAuth failure and leaves the token unchanged", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue(connection(29));
    const error = new InstagramOAuthError("refresh failed");
    deps.oauth.refreshToken.mockRejectedValue(error);
    await expect(refreshInstagramTokenIfDue(deps)).rejects.toBe(error);
    expect(deps.repository.replaceToken).not.toHaveBeenCalled();
  });
});

describe("GraphInstagramOAuthClient", () => {
  const options = {
    appId: "12345",
    appSecret: "private-app-secret",
    redirectUri: "https://example.com/api/instagram/callback",
    graphBaseUrl: "https://graph.instagram.com/v26.0",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the Instagram Business Login authorization URL", () => {
    const url = new URL(new GraphInstagramOAuthClient(options).authorizationUrl("state+value"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: options.appId,
      redirect_uri: options.redirectUri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_messages",
      state: "state+value",
      force_reauth: "true",
    });
  });

  it.each([
    {
      access_token: "short-token",
      permissions: "instagram_business_basic,instagram_business_manage_messages",
    },
    {
      data: [
        {
          access_token: "short-token",
          permissions: ["instagram_business_basic", "instagram_business_manage_messages"],
        },
      ],
    },
  ])("accepts a code response shape and strips the trailing fragment", async (body) => {
    const request = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", request);
    await expect(
      new GraphInstagramOAuthClient(options).exchangeCode("private-code#_"),
    ).resolves.toEqual({
      shortLivedToken: "short-token",
      permissions: ["instagram_business_basic", "instagram_business_manage_messages"],
    });
    const [url, init] = request.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.instagram.com/oauth/access_token");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ "content-type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      client_id: options.appId,
      client_secret: options.appSecret,
      grant_type: "authorization_code",
      redirect_uri: options.redirectUri,
      code: "private-code",
    });
  });

  it("exchanges, refreshes, reads the account and subscribes with the expected endpoints", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: "long-token", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ access_token: "fresh-token", expires_in: 7200 }))
      .mockResolvedValueOnce(Response.json({ user_id: "123456", username: "clandestino.sv" }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal("fetch", request);
    const oauth = new GraphInstagramOAuthClient(options);
    await expect(oauth.exchangeLongLivedToken("short+token")).resolves.toEqual({
      accessToken: "long-token",
      expiresInSeconds: 3600,
    });
    await expect(oauth.refreshToken("long-token")).resolves.toEqual({
      accessToken: "fresh-token",
      expiresInSeconds: 7200,
    });
    await expect(oauth.fetchAccount("fresh-token")).resolves.toEqual({
      accountId: "123456",
      username: "clandestino.sv",
    });
    await expect(oauth.subscribeWebhooks("fresh-token")).resolves.toBeUndefined();
    const urls = request.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[0]!.origin + urls[0]!.pathname).toBe("https://graph.instagram.com/access_token");
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      grant_type: "ig_exchange_token",
      client_secret: options.appSecret,
      access_token: "short+token",
    });
    expect(urls[1]!.pathname).toBe("/refresh_access_token");
    expect(Object.fromEntries(urls[1]!.searchParams)).toEqual({
      grant_type: "ig_refresh_token",
      access_token: "long-token",
    });
    expect(urls[2]!.toString()).toBe(`${options.graphBaseUrl}/me?fields=user_id,username`);
    expect(urls[3]!.pathname).toBe("/v26.0/me/subscribed_apps");
    expect(urls[3]!.searchParams.get("subscribed_fields")).toBe(
      "messages,messaging_seen,messaging_referral,message_reactions,messaging_postbacks,message_edit",
    );
    for (const [, init] of request.mock.calls) {
      expect(init!.cache).toBe("no-store");
      expect(init!.signal).toBeInstanceOf(AbortSignal);
    }
    expect(request.mock.calls[2]![1]!.headers).toEqual({ authorization: "Bearer fresh-token" });
    expect(request.mock.calls[3]![1]!.headers).toEqual({ authorization: "Bearer fresh-token" });
    expect(request.mock.calls[3]![1]!.method).toBe("POST");
  });

  it("rejects a numeric account id that loses precision during JSON parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"user_id":9007199254740993,"username":"clandestino.sv"}')),
    );
    await expect(
      new GraphInstagramOAuthClient(options).fetchAccount("private-token"),
    ).rejects.toBeInstanceOf(InstagramOAuthError);
  });

  it.each(["network", "timeout", "http", "json"])("redacts %s failures", async (failure) => {
    const request = vi.fn<typeof fetch>();
    if (failure === "network" || failure === "timeout") {
      request.mockRejectedValue(new Error("private-code private-token private-app-secret"));
    } else if (failure === "http") {
      request.mockResolvedValue(Response.json({ error: "private-token" }, { status: 400 }));
    } else {
      request.mockResolvedValue(new Response("private-token"));
    }
    vi.stubGlobal("fetch", request);
    const oauth = new GraphInstagramOAuthClient(options);
    await expect(oauth.exchangeCode("private-code")).rejects.toBeInstanceOf(InstagramOAuthError);
    request.mockRejectedValue(new Error("private-token"));
    await expect(oauth.refreshToken("private-token")).rejects.toThrow(/^Instagram request failed$/);
  });

  it.each([
    ["exchangeCode", { permissions: [] }],
    ["exchangeCode", { access_token: "short-token" }],
    ["exchangeLongLivedToken", { access_token: "long-token" }],
    ["refreshToken", { access_token: "fresh-token", expires_in: 0 }],
    ["fetchAccount", { user_id: "not-digits", username: "account" }],
    ["fetchAccount", { user_id: "12345" }],
    ["subscribeWebhooks", { success: false }],
  ] as const)("rejects missing or invalid fields from %s", async (method, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    await expect(
      new GraphInstagramOAuthClient(options)[method]("private-value"),
    ).rejects.toBeInstanceOf(InstagramOAuthError);
  });
});
