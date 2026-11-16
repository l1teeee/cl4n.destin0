import {
  InstagramOAuthError,
  type UnifiedLoginClient,
} from "@/application/messaging/instagram-connection";

import { graphJsonRequest } from "./graph-json-request";

export class GraphUnifiedLoginClient implements UnifiedLoginClient {
  constructor(
    private readonly options: {
      appId: string;
      appSecret: string;
      configId: string;
      redirectUri: string;
      graphBaseUrl: string;
    },
  ) {}

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.appId,
      config_id: this.options.configId,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      override_default_response_type: "true",
      state,
      prompt: "login",
    });
    return `https://www.facebook.com/dialog/oauth?${params}`;
  }

  async exchangeCode(code: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.options.appId,
      client_secret: this.options.appSecret,
      redirect_uri: this.options.redirectUri,
      code,
    });
    const body = await graphJsonRequest(
      `${this.options.graphBaseUrl}/oauth/access_token?${params}`,
    );
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new InstagramOAuthError("Invalid token response");
    }
    return body.access_token;
  }

  async inspectToken(accessToken: string): Promise<{ scopes: string[]; expiresAt: Date | null }> {
    const params = new URLSearchParams({
      input_token: accessToken,
      access_token: `${this.options.appId}|${this.options.appSecret}`,
    });
    const body = await graphJsonRequest(`${this.options.graphBaseUrl}/debug_token?${params}`);
    const data = body.data;
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      !("is_valid" in data) ||
      data.is_valid !== true ||
      !("app_id" in data) ||
      String(data.app_id) !== this.options.appId ||
      !("scopes" in data) ||
      !Array.isArray(data.scopes) ||
      !data.scopes.every((scope) => typeof scope === "string") ||
      !("expires_at" in data) ||
      typeof data.expires_at !== "number" ||
      !Number.isFinite(data.expires_at) ||
      data.expires_at < 0
    ) {
      throw new InstagramOAuthError("Invalid token inspection");
    }
    return {
      scopes: data.scopes,
      expiresAt: data.expires_at === 0 ? null : new Date(data.expires_at * 1000),
    };
  }

  async listAccounts(accessToken: string): Promise<Array<{ accountId: string; username: string }>> {
    const body = await graphJsonRequest(
      `${this.options.graphBaseUrl}/me/assigned_instagram_accounts?fields=id,username`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!Array.isArray(body.data)) {
      throw new InstagramOAuthError("Invalid Instagram accounts response");
    }
    return body.data.map((item: unknown) => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        !("id" in item) ||
        typeof item.id !== "string" ||
        !/^\d+$/.test(item.id) ||
        !("username" in item) ||
        typeof item.username !== "string" ||
        !item.username
      ) {
        throw new InstagramOAuthError("Invalid Instagram accounts response");
      }
      return { accountId: item.id, username: item.username };
    });
  }

  async subscribeWebhooks(accessToken: string, accountId: string): Promise<void> {
    const params = new URLSearchParams({
      subscribed_fields:
        "messages,messaging_seen,messaging_referral,message_reactions,messaging_postbacks",
    });
    const body = await graphJsonRequest(
      `${this.options.graphBaseUrl}/${accountId}/subscribed_apps?${params}`,
      { method: "POST", headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (body.success !== true) throw new InstagramOAuthError("Instagram subscription failed");
  }
}
