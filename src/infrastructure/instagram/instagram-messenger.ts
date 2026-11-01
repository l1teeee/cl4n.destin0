import type { InstagramMessenger } from "@/application/messaging/instagram-messenger";
import { env } from "@/infrastructure/config/env";

import { GraphInstagramMessenger } from "./graph-instagram-messenger";
import { LogInstagramMessenger } from "./log-instagram-messenger";

function createInstagramMessenger(): InstagramMessenger {
  if (env.MESSAGING_MODE === "log") return new LogInstagramMessenger();
  return new GraphInstagramMessenger({
    baseUrl: env.META_GRAPH_API_BASE_URL,
    accountId: env.INSTAGRAM_ACCOUNT_ID!,
    accessToken: env.INSTAGRAM_ACCESS_TOKEN!,
  });
}

export const instagramMessenger = createInstagramMessenger();
