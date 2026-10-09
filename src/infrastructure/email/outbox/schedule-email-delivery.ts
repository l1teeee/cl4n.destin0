import { after } from "next/server";

import { log } from "../../observability/logger";
import { drainEmailOutbox } from "./drain-email-outbox";

const IMMEDIATE_DRAIN_LIMIT = 10;
const IMMEDIATE_DRAIN_TIME_BUDGET_MS = 20_000;

export function scheduleEmailDelivery(input: { limit?: number; timeBudgetMs?: number } = {}): void {
  // after() keeps the serverless function alive to deliver without delaying the response.
  after(async () => {
    try {
      await drainEmailOutbox({
        limit: input.limit ?? IMMEDIATE_DRAIN_LIMIT,
        timeBudgetMs: input.timeBudgetMs ?? IMMEDIATE_DRAIN_TIME_BUDGET_MS,
      });
    } catch {
      log("error", "email_outbox_drain_failed");
    }
  });
}
