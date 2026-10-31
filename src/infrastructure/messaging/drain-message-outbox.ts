import {
  deliverMessagesNow,
  deliverPendingMessages,
  type MessageDeliverySummary,
} from "@/application/messaging/deliver-messages";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { instagramMessenger } from "@/infrastructure/instagram/instagram-messenger";
import { log } from "@/infrastructure/observability/logger";

const dependencies = {
  repository: postgresMessageRepository,
  messenger: instagramMessenger,
  now: Date.now,
  logFailure: (fields: {
    messageId: string;
    kind: import("@/domain/messaging/message-types").MessageKind;
    errorCode: string;
  }) => log("error", "instagram_message_delivery_failed", fields),
  logStaleLease: (fields: { messageId: string }) =>
    log("warn", "instagram_message_stale_lease", fields),
};

export function drainMessageOutbox(input: {
  limit: number;
  timeBudgetMs: number;
}): Promise<MessageDeliverySummary> {
  return deliverPendingMessages(dependencies, input);
}

export function drainMessagesNow(
  messageIds: readonly string[],
  input: { timeBudgetMs: number },
): Promise<MessageDeliverySummary> {
  return deliverMessagesNow(dependencies, messageIds, input);
}
