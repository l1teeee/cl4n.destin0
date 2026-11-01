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
  return {
    sent: 0,
    retried: 0,
    failed: 0,
    waitingWindow: 0,
    discarded: 0,
    outcomes: {},
  };
}

type MessagePart = { type: "text"; value: string } | { type: "image"; value: string };

function messageParts(row: DeliverableMessage): MessagePart[] {
  const text = row.body
    ? splitIntoChunks(row.body).map((value) => ({
        type: "text" as const,
        value,
      }))
    : [];
  const images = row.attachmentUrls.map((value) => ({
    type: "image" as const,
    value,
  }));
  return [...text, ...images];
}

function sendPart(
  messenger: InstagramMessenger,
  row: DeliverableMessage,
  part: MessagePart,
): Promise<{ messageId: string }> {
  return part.type === "text"
    ? messenger.sendText(row.recipientId, part.value)
    : messenger.sendImage(row.recipientId, part.value);
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
  deadline: number,
): Promise<"CONTINUE" | "DEADLINE"> {
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
    return "CONTINUE";
  }

  const parts = messageParts(row);
  let invalidParts: string | null = null;
  if (parts.length === 0) invalidParts = "EMPTY_MESSAGE";
  else if (parts.length > 20) invalidParts = "TOO_MANY_PARTS";
  else if (row.partsSent >= parts.length) invalidParts = "PARTS_MISMATCH";
  if (invalidParts) {
    if (
      await finish(
        dependencies,
        row,
        dependencies.repository.markFailed(row.id, row.lockedUntil, invalidParts),
      )
    ) {
      summary.failed += 1;
      summary.outcomes[row.id] = "FAILED";
    }
    return "CONTINUE";
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
    return "CONTINUE";
  }

  let lease = row.lockedUntil;
  for (let index = row.partsSent; index < parts.length; index += 1) {
    if (dependencies.now() >= deadline) {
      const released = await dependencies.repository.releaseClaim(row.id, lease);
      if (!released) dependencies.logStaleLease({ messageId: row.id });
      return "DEADLINE";
    }
    const extendedLease = await dependencies.repository.extendLease(row.id, lease);
    if (!extendedLease) {
      dependencies.logStaleLease({ messageId: row.id });
      return "CONTINUE";
    }
    lease = extendedLease;

    if (dependencies.now() >= deadline) {
      const released = await dependencies.repository.releaseClaim(row.id, lease);
      if (!released) dependencies.logStaleLease({ messageId: row.id });
      return "DEADLINE";
    }

    let response: { messageId: string } | null = null;
    let messengerError: unknown;
    try {
      response = await sendPart(dependencies.messenger, row, parts[index]!);
      if (!response.messageId) {
        throw new Error("META_NO_MESSAGE_ID");
      }
    } catch (error) {
      messengerError = error;
    }

    if (messengerError === undefined) {
      const lastPart = index === parts.length - 1;
      const recorded = await dependencies.repository.recordPart(
        row.id,
        lease,
        response!.messageId,
        lastPart,
      );
      if (!recorded) {
        dependencies.logStaleLease({ messageId: row.id });
        return "CONTINUE";
      }
      if (lastPart) {
        summary.sent += 1;
        summary.outcomes[row.id] = "SENT";
      }
      continue;
    }

    const failure = classifyMessageDeliveryFailure(messengerError, row.attempts + 1);
    let updated: boolean;
    if (failure.action === "WAIT_WINDOW") {
      updated = await finish(
        dependencies,
        { ...row, lockedUntil: lease },
        dependencies.repository.markWaitingWindow(row.id, lease, failure.errorCode),
      );
      if (updated) {
        summary.waitingWindow += 1;
        summary.outcomes[row.id] = "WAITING_WINDOW";
      }
    } else if (failure.action === "RETRY") {
      updated = await finish(
        dependencies,
        { ...row, lockedUntil: lease },
        dependencies.repository.scheduleRetry(
          row.id,
          lease,
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
        { ...row, lockedUntil: lease },
        dependencies.repository.markFailed(row.id, lease, failure.errorCode),
      );
      if (updated) {
        summary.failed += 1;
        summary.outcomes[row.id] = "FAILED";
      }
    }
    dependencies.logFailure({
      messageId: row.id,
      kind: row.kind,
      errorCode: failure.errorCode,
    });
    return "CONTINUE";
  }
  return "CONTINUE";
}

async function deliver(
  dependencies: DeliverMessagesDependencies,
  input: {
    limit: number;
    timeBudgetMs: number;
    messageIds?: readonly string[];
  },
): Promise<MessageDeliverySummary> {
  const summary = emptySummary();
  const startedAt = dependencies.now();
  const deadline = startedAt + input.timeBudgetMs;
  await dependencies.repository.repairWaitingContacts();
  for (let index = 0; index < input.limit; index += 1) {
    if (dependencies.now() >= deadline) break;
    const [row] = await dependencies.repository.claimDue(1, input.messageIds);
    if (!row) break;
    if ((await deliverClaimed(dependencies, row, summary, deadline)) === "DEADLINE") break;
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
    limit: Math.max(50, uniqueIds.length),
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
