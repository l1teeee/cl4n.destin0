import { ingestInstagramEvents } from "@/application/messaging/ingest-instagram-events";
import type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";
import { instagramMessenger } from "@/infrastructure/instagram/instagram-messenger";
import { log } from "@/infrastructure/observability/logger";

import { postgresMessageRepository } from "../db/repositories/postgres-message-repository";
import { drainMessageOutbox } from "./drain-message-outbox";

export function ingestConfiguredInstagramEvents(
  events: readonly InstagramWebhookEvent[],
  options: { knownUsernames?: Readonly<Record<string, string>> } = {},
) {
  return ingestInstagramEvents(
    {
      repository: postgresMessageRepository,
      messenger: instagramMessenger,
      deliver: async () => {
        await drainMessageOutbox({ limit: 50, timeBudgetMs: 20_000 });
      },
      logFailure: (fields) => log("error", "instagram_ingestion_followup_failed", fields),
    },
    events,
    options,
  );
}
