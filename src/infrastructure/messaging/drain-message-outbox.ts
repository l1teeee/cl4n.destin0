import {
  deliverMessagesNow,
  deliverPendingMessages,
  type MessageDeliverySummary,
} from "@/application/messaging/deliver-messages";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { loadInstagramMessenger } from "@/infrastructure/instagram/instagram-messenger";
import { log } from "@/infrastructure/observability/logger";

const dependencies = {
  repository: postgresMessageRepository,
  now: Date.now,
  logFailure: (fields: {
    messageId: string;
    kind: import("@/domain/messaging/message-types").MessageKind;
    errorCode: string;
  }) => log("error", "instagram_message_delivery_failed", fields),
  logStaleLease: (fields: { messageId: string }) =>
    log("warn", "instagram_message_stale_lease", fields),
};

function notConnected(): MessageDeliverySummary {
  log("warn", "instagram_not_connected");
  return { sent: 0, retried: 0, failed: 0, waitingWindow: 0, discarded: 0, outcomes: {} };
}

export async function drainMessageOutbox(input: {
  limit: number;
  timeBudgetMs: number;
}): Promise<MessageDeliverySummary> {
  const messenger = await loadInstagramMessenger();
  if (!messenger) return notConnected();
  return deliverPendingMessages({ ...dependencies, messenger }, input);
}

export async function drainMessagesNow(
  messageIds: readonly string[],
  input: { timeBudgetMs: number },
): Promise<MessageDeliverySummary> {
  const messenger = await loadInstagramMessenger();
  if (!messenger) return notConnected();
  return deliverMessagesNow({ ...dependencies, messenger }, messageIds, input);
}
