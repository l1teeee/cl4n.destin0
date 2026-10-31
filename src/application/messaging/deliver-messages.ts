import type { InstagramMessenger } from "./instagram-messenger";
import { classifyMessageDeliveryFailure } from "./message-delivery-policy";
import type { DeliverableMessage, MessageDeliveryRepository } from "./message-repository";
import { isStillRelevant } from "@/domain/messaging/message-relevance";
import { isMessagingWindowOpen } from "@/domain/messaging/messaging-window";
import { splitIntoChunks } from "@/domain/messaging/text-chunks";
import type { MessageKind, MessageStatus } from "@/domain/messaging/message-types";

export interface MessageDeliverySummary {
  sent: number;
  retried: number;
  failed: number;
  waitingWindow: number;
  discarded: number;
  outcomes: Record<string, MessageStatus>;
}

export interface DeliverMessagesDependencies {
  repository: MessageDeliveryRepository;
  messenger: InstagramMessenger;
  now(): number;
  logFailure(fields: { messageId: string; kind: MessageKind; errorCode: string }): void;
  logStaleLease(fields: { messageId: string }): void;
}

function emptySummary(): MessageDeliverySummary {
  return { sent: 0, retried: 0, failed: 0, waitingWindow: 0, discarded: 0, outcomes: {} };
}

async function sendMessage(
  messenger: InstagramMessenger,
  row: DeliverableMessage,
): Promise<string> {
  let lastMessageId: string | null = null;
  if (row.body) {
    for (const chunk of splitIntoChunks(row.body)) {
      lastMessageId = (await messenger.sendText(row.recipientId, chunk)).messageId;
    }
  }
  for (const url of row.attachmentUrls) {
    lastMessageId = (await messenger.sendImage(row.recipientId, url)).messageId;
  }
  if (!lastMessageId) throw new Error("Deliverable message has no content");
  return lastMessageId;
}

async function finish(
  dependencies: DeliverMessagesDependencies,
  row: DeliverableMessage,
  update: Promise<boolean>,
): Promise<boolean> {
  const updated = await update;
  if (!updated) dependencies.logStaleLease({ messageId: row.id });
  return updated;
}

async function deliverClaimed(
  dependencies: DeliverMessagesDependencies,
  row: DeliverableMessage,
  summary: MessageDeliverySummary,
): Promise<void> {
  if (!isStillRelevant(row.kind, row.relevance)) {
    if (
      await finish(
        dependencies,
        row,
        dependencies.repository.markDiscarded(row.id, row.lockedUntil, "NOT_RELEVANT"),
      )
    ) {
      summary.discarded += 1;
      summary.outcomes[row.id] = "DISCARDED";
    }
    return;
  }

  if (!isMessagingWindowOpen(row.lastInboundAt, new Date(dependencies.now()))) {
    if (
      await finish(
        dependencies,
        row,
        dependencies.repository.markWaitingWindow(row.id, row.lockedUntil),
      )
    ) {
      summary.waitingWindow += 1;
      summary.outcomes[row.id] = "WAITING_WINDOW";
    }
    return;
  }

  try {
    const externalMessageId = await sendMessage(dependencies.messenger, row);
    if (
      await finish(
        dependencies,
        row,
        dependencies.repository.markSent(row.id, row.lockedUntil, externalMessageId),
      )
    ) {
      summary.sent += 1;
      summary.outcomes[row.id] = "SENT";
    }
  } catch (error) {
    const failure = classifyMessageDeliveryFailure(error, row.attempts);
    let updated: boolean;
    if (failure.action === "WAIT_WINDOW") {
      updated = await finish(
        dependencies,
        row,
        dependencies.repository.markWaitingWindow(row.id, row.lockedUntil, failure.errorCode),
      );
      if (updated) {
        summary.waitingWindow += 1;
        summary.outcomes[row.id] = "WAITING_WINDOW";
      }
    } else if (failure.action === "RETRY") {
      updated = await finish(
        dependencies,
        row,
        dependencies.repository.scheduleRetry(
          row.id,
          row.lockedUntil,
          failure.delaySeconds,
          failure.errorCode,
        ),
      );
      if (updated) {
        summary.retried += 1;
        summary.outcomes[row.id] = "QUEUED";
      }
    } else {
      updated = await finish(
        dependencies,
        row,
        dependencies.repository.markFailed(row.id, row.lockedUntil, failure.errorCode),
      );
      if (updated) {
        summary.failed += 1;
        summary.outcomes[row.id] = "FAILED";
      }
    }
    dependencies.logFailure({ messageId: row.id, kind: row.kind, errorCode: failure.errorCode });
  }
}

async function deliver(
  dependencies: DeliverMessagesDependencies,
  input: { limit: number; timeBudgetMs: number; messageIds?: readonly string[] },
): Promise<MessageDeliverySummary> {
  const summary = emptySummary();
  const startedAt = dependencies.now();
  for (let index = 0; index < input.limit; index += 1) {
    if (dependencies.now() - startedAt >= input.timeBudgetMs) break;
    const [row] = await dependencies.repository.claimDue(1, input.messageIds);
    if (!row) break;
    await deliverClaimed(dependencies, row, summary);
  }
  return summary;
}

export function deliverPendingMessages(
  dependencies: DeliverMessagesDependencies,
  input: { limit: number; timeBudgetMs: number },
): Promise<MessageDeliverySummary> {
  return deliver(dependencies, input);
}

export async function deliverMessagesNow(
  dependencies: DeliverMessagesDependencies,
  messageIds: readonly string[],
  input: { timeBudgetMs: number },
): Promise<MessageDeliverySummary> {
  const uniqueIds = [...new Set(messageIds)];
  const summary = await deliver(dependencies, {
    limit: uniqueIds.length,
    timeBudgetMs: input.timeBudgetMs,
    messageIds: uniqueIds,
  });
  for (const id of uniqueIds) {
    if (!summary.outcomes[id]) {
      const status = await dependencies.repository.getStatus(id);
      if (status) summary.outcomes[id] = status;
    }
  }
  return summary;
}
