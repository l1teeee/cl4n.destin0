import {
  ingestInstagramEvents,
  retryInboundImages,
} from "@/application/messaging/ingest-instagram-events";
import type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";
import { loadInstagramMessenger } from "@/infrastructure/instagram/instagram-messenger";
import { log } from "@/infrastructure/observability/logger";

import { postgresMessageRepository } from "../db/repositories/postgres-message-repository";
import { drainMessageOutbox } from "./drain-message-outbox";

export async function ingestConfiguredInstagramEvents(
  events: readonly InstagramWebhookEvent[],
  options: {
    ownAccountId: string | null;
    knownUsernames?: Readonly<Record<string, string>>;
    deadline?: number;
  },
) {
  const messenger = await loadInstagramMessenger();
  if (!messenger) throw new Error("Instagram is not connected");
  return ingestInstagramEvents(
    {
      repository: postgresMessageRepository,
      messenger,
      deliver: async (deadline) => {
        const timeBudgetMs = deadline === undefined ? 20_000 : Math.max(0, deadline - Date.now());
        if (timeBudgetMs > 0) await drainMessageOutbox({ limit: 50, timeBudgetMs });
      },
      logFailure: (fields) => log("error", "instagram_ingestion_followup_failed", fields),
    },
    events,
    options,
  );
}

export async function retryConfiguredInboundImages(limit = 20, deadline?: number): Promise<void> {
  const messenger = await loadInstagramMessenger();
  if (!messenger) return;
  return retryInboundImages(
    {
      repository: postgresMessageRepository,
      messenger,
      logFailure: (fields) => log("error", "instagram_ingestion_followup_failed", fields),
    },
    [],
    limit,
    deadline,
  );
}
