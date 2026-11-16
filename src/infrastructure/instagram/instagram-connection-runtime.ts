import type { InstagramConnectionKind } from "@/application/messaging/instagram-connection";
import {
  completeInstagramConnection,
  completeUnifiedInstagramConnection,
  disconnectInstagram,
  refreshInstagramTokenIfDue,
} from "@/application/messaging/instagram-connection-use-cases";
import { env } from "@/infrastructure/config/env";
import { postgresInstagramConnectionRepository } from "@/infrastructure/db/repositories/postgres-instagram-connection-repository";

import { GraphInstagramOAuthClient } from "./graph-instagram-oauth-client";
import { GraphUnifiedLoginClient } from "./graph-unified-login-client";

export type InstagramLinkFlow = "UNIFIED_LOGIN" | "INSTAGRAM_LOGIN";

export function instagramLinkFlow(): InstagramLinkFlow {
  return env.META_APP_ID && env.META_APP_SECRET && env.INSTAGRAM_LOGIN_CONFIG_ID
    ? "UNIFIED_LOGIN"
    : "INSTAGRAM_LOGIN";
}

export type InstagramConnectionStatus =
  | { mode: "log" }
  | { mode: "instagram"; connection: null }
  | {
      mode: "instagram";
      connection: {
        username: string;
        connectedAt: Date;
        tokenExpiresAt: Date | null;
        kind: InstagramConnectionKind;
      };
    };

export function instagramRedirectUri(): string {
  return new URL("/api/instagram/callback", env.APP_BASE_URL).toString();
}

let oauth: GraphInstagramOAuthClient | undefined;
let unifiedClient: GraphUnifiedLoginClient | undefined;

function dependencies() {
  if (env.MESSAGING_MODE !== "instagram") throw new Error("Instagram mode is not configured");
  if (env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET) {
    oauth ??= new GraphInstagramOAuthClient({
      appId: env.INSTAGRAM_APP_ID,
      appSecret: env.INSTAGRAM_APP_SECRET,
      redirectUri: instagramRedirectUri(),
      graphBaseUrl: env.META_GRAPH_API_BASE_URL,
    });
  }
  return {
    oauth: oauth ?? null,
    repository: postgresInstagramConnectionRepository,
    now: () => new Date(),
  };
}

function unifiedLoginClient(): GraphUnifiedLoginClient {
  if (env.MESSAGING_MODE !== "instagram") throw new Error("Instagram mode is not configured");
  unifiedClient ??= new GraphUnifiedLoginClient({
    appId: env.META_APP_ID!,
    appSecret: env.META_APP_SECRET!,
    configId: env.INSTAGRAM_LOGIN_CONFIG_ID!,
    redirectUri: instagramRedirectUri(),
    graphBaseUrl: env.META_UNIFIED_GRAPH_API_BASE_URL,
  });
  return unifiedClient;
}

export function instagramAuthorizationUrl(state: string): string {
  if (instagramLinkFlow() === "UNIFIED_LOGIN") return unifiedLoginClient().authorizationUrl(state);
  const { oauth } = dependencies();
  if (!oauth) throw new Error("Instagram Login is not configured");
  return oauth.authorizationUrl(state);
}

export function completeConfiguredInstagramConnection(code: string, adminId: string) {
  const input = {
    code,
    adminId,
    requiredUsername: env.INSTAGRAM_ALLOW_ANY_ACCOUNT
      ? null
      : (env.NEXT_PUBLIC_INSTAGRAM_USERNAME ?? null),
  };
  if (instagramLinkFlow() === "UNIFIED_LOGIN") {
    return completeUnifiedInstagramConnection(
      { client: unifiedLoginClient(), repository: postgresInstagramConnectionRepository },
      input,
    );
  }
  const deps = dependencies();
  if (!deps.oauth) throw new Error("Instagram Login is not configured");
  return completeInstagramConnection({ ...deps, oauth: deps.oauth }, input);
}

export function disconnectConfiguredInstagram(adminId: string) {
  return disconnectInstagram({ repository: postgresInstagramConnectionRepository }, adminId);
}

export function refreshConfiguredInstagramToken() {
  return refreshInstagramTokenIfDue(dependencies());
}

export async function loadInstagramConnectionStatus(): Promise<InstagramConnectionStatus> {
  if (env.MESSAGING_MODE === "log") return { mode: "log" };
  const connection = await postgresInstagramConnectionRepository.find();
  if (!connection) return { mode: "instagram", connection: null };
  return {
    mode: "instagram",
    connection: {
      username: connection.username,
      connectedAt: connection.connectedAt,
      tokenExpiresAt: connection.tokenExpiresAt,
      kind: connection.kind,
    },
  };
}
