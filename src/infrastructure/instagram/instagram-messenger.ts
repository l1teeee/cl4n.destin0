import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import { env } from "@/infrastructure/config/env";
import { postgresInstagramConnectionRepository } from "@/infrastructure/db/repositories/postgres-instagram-connection-repository";

import { GraphInstagramMessenger } from "./graph-instagram-messenger";
import { LogInstagramMessenger } from "./log-instagram-messenger";

const logMessenger = new LogInstagramMessenger();

export async function loadInstagramMessenger(): Promise<InstagramMessenger | null> {
  if (env.MESSAGING_MODE === "log") return logMessenger;
  const connection = await postgresInstagramConnectionRepository.find();
  if (!connection) return null;
  return new GraphInstagramMessenger({
    baseUrl: env.META_GRAPH_API_BASE_URL,
    accountId: connection.accountId,
    accessToken: connection.accessToken,
  });
}
