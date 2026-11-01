import { after } from "next/server";

import { log } from "@/infrastructure/observability/logger";

import { drainMessageOutbox } from "./drain-message-outbox";

const DEFAULT_LIMIT = 10;
const DEFAULT_TIME_BUDGET_MS = 20_000;

export function scheduleMessageDelivery(
  input: { limit?: number; timeBudgetMs?: number } = {},
): void {
  after(async () => {
    try {
      await drainMessageOutbox({
        limit: input.limit ?? DEFAULT_LIMIT,
        timeBudgetMs: input.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS,
      });
    } catch {
      log("error", "instagram_message_outbox_drain_failed");
    }
  });
}
