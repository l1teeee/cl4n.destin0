import {
  InstagramOAuthError,
  type InstagramOAuthClient,
} from "@/application/messaging/instagram-connection";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstagramOAuthError("Invalid Instagram response");
  }
  return value as Record<string, unknown>;
}

function tokenResult(body: Record<string, unknown>) {
  if (
    typeof body.access_token !== "string" ||
    !body.access_token ||
    typeof body.expires_in !== "number" ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0
  ) {
    throw new InstagramOAuthError("Invalid Instagram token response");
  }
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}

export class GraphInstagramOAuthClient implements InstagramOAuthClient {
  constructor(
    private readonly options: {
      appId: string;
      appSecret: string;
      redirectUri: string;
      graphBaseUrl: string;
    },
  ) {}

  private async request(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    let body: unknown;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (!response.ok) throw new InstagramOAuthError("Instagram request rejected");
      body = await response.json();
    } catch {
      throw new InstagramOAuthError("Instagram request failed");
    }
    return record(body);
  }

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.options.appId,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_messages",
      state,
      force_reauth: "true",
    });
    return `https://www.instagram.com/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<{ shortLivedToken: string; permissions: string[] }> {
    const body = await this.request("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.appId,
        client_secret: this.options.appSecret,
        grant_type: "authorization_code",
        redirect_uri: this.options.redirectUri,
        code: code.replace(/#_$/, ""),
      }),
    });
    const data = Array.isArray(body.data) ? record(body.data[0]) : body;
    if (typeof data.access_token !== "string" || !data.access_token) {
      throw new InstagramOAuthError("Invalid Instagram code response");
    }
    let permissions: string[];
    if (typeof data.permissions === "string") {
      permissions = data.permissions.split(",").map((permission) => permission.trim());
    } else if (
      Array.isArray(data.permissions) &&
      data.permissions.every((permission) => typeof permission === "string")
    ) {
      permissions = data.permissions;
    } else {
      throw new InstagramOAuthError("Invalid Instagram permissions response");
    }
    return { shortLivedToken: data.access_token, permissions };
  }

  async exchangeLongLivedToken(shortLivedToken: string) {
    const params = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: this.options.appSecret,
      access_token: shortLivedToken,
    });
    return tokenResult(await this.request(`https://graph.instagram.com/access_token?${params}`));
  }

  async refreshToken(accessToken: string) {
    const params = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: accessToken,
    });
    return tokenResult(
      await this.request(`https://graph.instagram.com/refresh_access_token?${params}`),
    );
  }

  async fetchAccount(accessToken: string): Promise<{ accountId: string; username: string }> {
    const body = await this.request(`${this.options.graphBaseUrl}/me?fields=user_id,username`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const accountId = body.user_id;
    if (
      typeof accountId !== "string" ||
      !/^\d+$/.test(accountId) ||
      typeof body.username !== "string" ||
      !body.username
    ) {
      throw new InstagramOAuthError("Invalid Instagram account response");
    }
    return { accountId, username: body.username };
  }

  async subscribeWebhooks(accessToken: string): Promise<void> {
    const params = new URLSearchParams({
      subscribed_fields:
        "messages,messaging_seen,messaging_referral,message_reactions,messaging_postbacks,message_edit",
    });
    const body = await this.request(`${this.options.graphBaseUrl}/me/subscribed_apps?${params}`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (body.success !== true) throw new InstagramOAuthError("Instagram subscription failed");
  }
}
