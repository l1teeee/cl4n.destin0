import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InstagramOAuthError,
  type InstagramConnection,
  type UnifiedLoginClient,
} from "@/application/messaging/instagram-connection";
import {
  completeInstagramConnection,
  completeUnifiedInstagramConnection,
  disconnectInstagram,
  refreshInstagramTokenIfDue,
} from "@/application/messaging/instagram-connection-use-cases";
import { getMessagingHealth } from "@/application/messaging/messaging-health";
import { GraphInstagramOAuthClient } from "@/infrastructure/instagram/graph-instagram-oauth-client";

const now = new Date("2026-11-01T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const input = { code: "private-code", adminId: "admin-id", requiredUsername: "Clandestino.SV" };

describe("configured Instagram connection", () => {
  it.each([
    [true, null, "legacy"],
    [false, "clandestino.sv", "legacy"],
    [true, null, "unified"],
    [false, "clandestino.sv", "unified"],
    [false, "clandestino.sv", "both"],
  ])(
    "passes the username when allow-any is %s using %s (%s)",
    async (allowAny, requiredUsername, flow) => {
      const complete = vi.fn();
      const completeUnified = vi.fn();
      const disconnect = vi.fn();
      const refresh = vi.fn();
      const repository = {};
      vi.resetModules();
      vi.doMock("@/application/messaging/instagram-connection-use-cases", () => ({
        completeInstagramConnection: complete,
        completeUnifiedInstagramConnection: completeUnified,
        disconnectInstagram: disconnect,
        refreshInstagramTokenIfDue: refresh,
      }));
      vi.doMock("@/infrastructure/config/env", () => ({
        env: {
          MESSAGING_MODE: "instagram",
          INSTAGRAM_ALLOW_ANY_ACCOUNT: allowAny,
          NEXT_PUBLIC_INSTAGRAM_USERNAME: "clandestino.sv",
          APP_BASE_URL: "https://example.com",
          INSTAGRAM_APP_ID: flow === "unified" ? undefined : "12345",
          INSTAGRAM_APP_SECRET: flow === "unified" ? undefined : "legacy-app-secret",
          META_GRAPH_API_BASE_URL: "https://graph.instagram.com/v26.0",
          META_APP_ID: flow === "legacy" ? undefined : "56789",
          META_APP_SECRET: flow === "legacy" ? undefined : "unified-app-secret",
          INSTAGRAM_LOGIN_CONFIG_ID: flow === "legacy" ? undefined : "98765",
          META_UNIFIED_GRAPH_API_BASE_URL: "https://graph.facebook.com/v27.0",
        },
      }));
      vi.doMock(
        "@/infrastructure/db/repositories/postgres-instagram-connection-repository",
        () => ({
          postgresInstagramConnectionRepository: repository,
        }),
      );
      try {
        const runtime = await import("@/infrastructure/instagram/instagram-connection-runtime");
        const expectedFlow = flow === "legacy" ? "INSTAGRAM_LOGIN" : "UNIFIED_LOGIN";
        expect(runtime.instagramLinkFlow()).toBe(expectedFlow);
        const authorizationUrl = new URL(runtime.instagramAuthorizationUrl("state"));
        expect(authorizationUrl.origin).toBe(
          flow === "legacy" ? "https://www.instagram.com" : "https://www.facebook.com",
        );
        expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
          "https://example.com/api/instagram/callback",
        );
        runtime.completeConfiguredInstagramConnection("code", "admin");
        const selected = flow === "legacy" ? complete : completeUnified;
        const other = flow === "legacy" ? completeUnified : complete;
        expect(selected).toHaveBeenCalledWith(expect.anything(), {
          code: "code",
          adminId: "admin",
          requiredUsername,
        });
        expect(other).not.toHaveBeenCalled();
        runtime.disconnectConfiguredInstagram("admin");
        expect(disconnect).toHaveBeenCalledWith({ repository }, "admin");
        runtime.refreshConfiguredInstagramToken();
        expect(refresh).toHaveBeenCalledWith({
          repository,
          now: expect.any(Function),
          oauth: flow === "unified" ? null : expect.anything(),
        });
      } finally {
        vi.doUnmock("@/application/messaging/instagram-connection-use-cases");
        vi.doUnmock("@/infrastructure/config/env");
        vi.doUnmock("@/infrastructure/db/repositories/postgres-instagram-connection-repository");
        vi.resetModules();
      }
    },
  );
});

describe("configured Instagram messenger", () => {
  it.each(["INSTAGRAM_LOGIN", "UNIFIED_LOGIN"] as const)(
    "uses the stored %s kind even when both apps are configured",
    async (kind) => {
      vi.resetModules();
      vi.doMock("@/infrastructure/config/env", () => ({
        env: {
          MESSAGING_MODE: "instagram",
          META_APP_ID: "56789",
          META_APP_SECRET: "unified-app-secret",
          INSTAGRAM_LOGIN_CONFIG_ID: "98765",
          INSTAGRAM_APP_ID: "12345",
          INSTAGRAM_APP_SECRET: "legacy-app-secret",
          META_GRAPH_API_BASE_URL: "https://graph.instagram.com/v26.0",
          META_UNIFIED_GRAPH_API_BASE_URL: "https://graph.facebook.com/v27.0",
        },
      }));
      const stored = {
        ...connection(20),
        kind,
        tokenExpiresAt: kind === "UNIFIED_LOGIN" ? null : connection(20).tokenExpiresAt,
      };
      vi.doMock(
        "@/infrastructure/db/repositories/postgres-instagram-connection-repository",
        () => ({ postgresInstagramConnectionRepository: { find: async () => stored } }),
      );
      const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message_id: "mid" }));
      vi.stubGlobal("fetch", request);
      try {
        const { loadInstagramMessenger } =
          await import("@/infrastructure/instagram/instagram-messenger");
        const messenger = await loadInstagramMessenger();
        await messenger!.sendText("5678", "hola");
        const baseUrl =
          kind === "UNIFIED_LOGIN"
            ? "https://graph.facebook.com/v27.0"
            : "https://graph.instagram.com/v26.0";
        expect(request).toHaveBeenCalledWith(
          `${baseUrl}/1234/messages`,
          expect.objectContaining({
            headers: { authorization: "Bearer current-token", "content-type": "application/json" },
            body: JSON.stringify({ recipient: { id: "5678" }, message: { text: "hola" } }),
          }),
        );
        const { loadInstagramConnectionStatus } =
          await import("@/infrastructure/instagram/instagram-connection-runtime");
        expect(await loadInstagramConnectionStatus()).toEqual({
          mode: "instagram",
          connection: {
            username: stored.username,
            connectedAt: stored.connectedAt,
            kind,
            tokenExpiresAt: stored.tokenExpiresAt,
          },
        });
      } finally {
        vi.unstubAllGlobals();
        vi.doUnmock("@/infrastructure/config/env");
        vi.doUnmock("@/infrastructure/db/repositories/postgres-instagram-connection-repository");
        vi.resetModules();
      }
    },
  );
});

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
      findTokenExpiry: vi.fn(async () => null),
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
    kind: "INSTAGRAM_LOGIN",
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
      kind: "INSTAGRAM_LOGIN",
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

function unifiedDependencies() {
  return {
    client: {
      authorizationUrl: vi.fn<UnifiedLoginClient["authorizationUrl"]>(),
      exchangeCode: vi.fn(async () => "system-token"),
      inspectToken: vi.fn<UnifiedLoginClient["inspectToken"]>(async () => ({
        scopes: ["instagram_basic", "instagram_manage_messages"],
        expiresAt: null,
      })),
      listAccounts: vi.fn(async () => [{ accountId: "1234", username: "clandestino.sv" }]),
      subscribeWebhooks: vi.fn(async () => undefined),
    },
    repository: dependencies().repository,
  };
}

describe("completeUnifiedInstagramConnection", () => {
  it.each([null, new Date("2027-01-01")])(
    "saves the inspected expiry %s after subscribing",
    async (expiresAt) => {
      const deps = unifiedDependencies();
      deps.client.inspectToken.mockResolvedValue({
        scopes: ["instagram_basic", "instagram_manage_messages"],
        expiresAt,
      });
      deps.client.listAccounts.mockResolvedValue([
        { accountId: "5678", username: "someone.else" },
        { accountId: "1234", username: "clandestino.sv" },
      ]);
      await expect(completeUnifiedInstagramConnection(deps, input)).resolves.toEqual({
        ok: true,
        username: "clandestino.sv",
      });
      expect(deps.client.exchangeCode).toHaveBeenCalledWith(input.code);
      expect(deps.client.inspectToken).toHaveBeenCalledWith("system-token");
      expect(deps.client.listAccounts).toHaveBeenCalledWith("system-token");
      expect(deps.client.subscribeWebhooks).toHaveBeenCalledWith("system-token", "1234");
      expect(deps.repository.save).toHaveBeenCalledWith({
        accountId: "1234",
        username: "clandestino.sv",
        accessToken: "system-token",
        tokenExpiresAt: expiresAt,
        kind: "UNIFIED_LOGIN",
        adminId: input.adminId,
      });
      const order = [
        deps.client.exchangeCode,
        deps.client.inspectToken,
        deps.client.listAccounts,
        deps.client.subscribeWebhooks,
        deps.repository.save,
      ].map((method) => method.mock.invocationCallOrder[0]!);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    },
  );

  it.each([
    { scopes: [] },
    { scopes: ["instagram_basic"] },
    { scopes: ["instagram_manage_messages"] },
  ])("requires both permissions: $scopes", async ({ scopes }) => {
    const deps = unifiedDependencies();
    deps.client.inspectToken.mockResolvedValue({ scopes, expiresAt: null });
    await expect(completeUnifiedInstagramConnection(deps, input)).resolves.toEqual({
      ok: false,
      error: "MISSING_PERMISSION",
    });
    expect(deps.client.listAccounts).toHaveBeenCalledOnce();
    expect(deps.client.subscribeWebhooks).not.toHaveBeenCalled();
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it("rejects a nonmatching account in restricted mode", async () => {
    const deps = unifiedDependencies();
    deps.client.listAccounts.mockResolvedValue([{ accountId: "5678", username: "someone.else" }]);
    await expect(completeUnifiedInstagramConnection(deps, input)).resolves.toEqual({
      ok: false,
      error: "WRONG_ACCOUNT",
    });
    expect(deps.client.subscribeWebhooks).not.toHaveBeenCalled();
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it.each([
    { accounts: [], error: "NO_ACCOUNT" },
    {
      accounts: [
        { accountId: "1", username: "one" },
        { accountId: "2", username: "two" },
      ],
      error: "MULTIPLE_ACCOUNTS",
    },
  ])("rejects $error in allow-any mode", async ({ accounts, error }) => {
    const deps = unifiedDependencies();
    deps.client.listAccounts.mockResolvedValue(accounts);
    await expect(
      completeUnifiedInstagramConnection(deps, { ...input, requiredUsername: null }),
    ).resolves.toEqual({
      ok: false,
      error,
    });
    expect(deps.client.subscribeWebhooks).not.toHaveBeenCalled();
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it("accepts exactly one account in allow-any mode", async () => {
    const deps = unifiedDependencies();
    deps.client.listAccounts.mockResolvedValue([{ accountId: "5678", username: "someone.else" }]);
    await expect(
      completeUnifiedInstagramConnection(deps, { ...input, requiredUsername: null }),
    ).resolves.toEqual({
      ok: true,
      username: "someone.else",
    });
    expect(deps.repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "5678", kind: "UNIFIED_LOGIN" }),
    );
  });

  it.each(["exchangeCode", "inspectToken", "listAccounts"] as const)(
    "maps %s OAuth errors",
    async (method) => {
      const deps = unifiedDependencies();
      deps.client[method].mockRejectedValue(new InstagramOAuthError("request failed"));
      await expect(completeUnifiedInstagramConnection(deps, input)).resolves.toEqual({
        ok: false,
        error: "TOKEN_EXCHANGE_FAILED",
      });
      expect(deps.client.subscribeWebhooks).not.toHaveBeenCalled();
      expect(deps.repository.save).not.toHaveBeenCalled();
    },
  );

  it("maps subscription failures without replacing the existing connection", async () => {
    const deps = unifiedDependencies();
    deps.client.subscribeWebhooks.mockRejectedValue(new InstagramOAuthError("request failed"));
    await expect(completeUnifiedInstagramConnection(deps, input)).resolves.toEqual({
      ok: false,
      error: "SUBSCRIBE_FAILED",
    });
    expect(deps.repository.save).not.toHaveBeenCalled();
  });

  it.each(["exchangeCode", "inspectToken", "listAccounts", "subscribeWebhooks"] as const)(
    "propagates unexpected %s errors",
    async (method) => {
      const deps = unifiedDependencies();
      const error = new Error("unexpected failure");
      deps.client[method].mockRejectedValue(error);
      await expect(completeUnifiedInstagramConnection(deps, input)).rejects.toBe(error);
      expect(deps.repository.save).not.toHaveBeenCalled();
    },
  );
});

describe("messaging connection health", () => {
  it.each([
    [null, "MISSING"],
    [{ expiresAt: null }, "CONNECTED"],
    [{ expiresAt: new Date(now.getTime() - 1) }, "EXPIRED"],
    [{ expiresAt: new Date(now.getTime() + 1) }, "CONNECTED"],
  ] as const)("reports %j as %s", async (expiry, expected) => {
    const health = await getMessagingHealth({
      findConnectionExpiry: async () => expiry,
      usesInstagram: true,
      now,
      messages: {
        countUndeliveredMessages: async () => ({ failed: 0, retrying: 0 }),
        lastMetaSignalAt: async () => null,
        listUnsentMessages: async () => [],
      },
    });
    expect(health.connection).toBe(expected);
    expect(health.failing).toBe(expected !== "CONNECTED");
  });
});

describe("disconnectInstagram", () => {
  it("deletes for the actor and reports a missing connection", async () => {
    const deps = { repository: dependencies().repository };
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
  it.each([null, new Date("2026-11-02")])("skips unified tokens with expiry %s", async (expiry) => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue({
      ...connection(1),
      kind: "UNIFIED_LOGIN",
      tokenExpiresAt: expiry,
    });
    await expect(refreshInstagramTokenIfDue({ ...deps, oauth: null })).resolves.toBe(
      "NOT_EXPIRING",
    );
    expect(deps.oauth.refreshToken).not.toHaveBeenCalled();
    expect(deps.repository.replaceToken).not.toHaveBeenCalled();
  });

  it("skips a connection without an expiry before requiring OAuth", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue({ ...connection(1), tokenExpiresAt: null });
    await expect(refreshInstagramTokenIfDue({ ...deps, oauth: null })).resolves.toBe(
      "NOT_EXPIRING",
    );
  });

  it("requires legacy OAuth for an expiring legacy connection", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue(connection(31));
    await expect(refreshInstagramTokenIfDue({ ...deps, oauth: null })).rejects.toThrow(
      "Instagram Login is not configured",
    );
    expect(deps.repository.replaceToken).not.toHaveBeenCalled();
  });

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
