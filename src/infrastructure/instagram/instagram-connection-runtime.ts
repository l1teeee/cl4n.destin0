import {
  completeInstagramConnection,
  disconnectInstagram,
  refreshInstagramTokenIfDue,
} from "@/application/messaging/instagram-connection-use-cases";
import { env } from "@/infrastructure/config/env";
import { postgresInstagramConnectionRepository } from "@/infrastructure/db/repositories/postgres-instagram-connection-repository";

import { GraphInstagramOAuthClient } from "./graph-instagram-oauth-client";

export type InstagramConnectionStatus =
  | { mode: "log" }
  | { mode: "instagram"; connection: null }
  | {
      mode: "instagram";
      connection: { username: string; connectedAt: Date; tokenExpiresAt: Date };
    };

export function instagramRedirectUri(): string {
  return new URL("/api/instagram/callback", env.APP_BASE_URL).toString();
}

let oauth: GraphInstagramOAuthClient | undefined;

function dependencies() {
  if (env.MESSAGING_MODE !== "instagram") throw new Error("Instagram mode is not configured");
  oauth ??= new GraphInstagramOAuthClient({
    appId: env.INSTAGRAM_APP_ID!,
    appSecret: env.INSTAGRAM_APP_SECRET!,
    redirectUri: instagramRedirectUri(),
    graphBaseUrl: env.META_GRAPH_API_BASE_URL,
  });
  return { oauth, repository: postgresInstagramConnectionRepository, now: () => new Date() };
}

export function instagramAuthorizationUrl(state: string): string {
  return dependencies().oauth.authorizationUrl(state);
}

export function completeConfiguredInstagramConnection(code: string, adminId: string) {
  return completeInstagramConnection(dependencies(), {
    code,
    adminId,
    requiredUsername: env.NEXT_PUBLIC_INSTAGRAM_USERNAME ?? null,
  });
}

export function disconnectConfiguredInstagram(adminId: string) {
  return disconnectInstagram(dependencies(), adminId);
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
    },
  };
}
