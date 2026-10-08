import type { EmailSender } from "@/application/ports/email-sender";

import { classifyEmailDeliveryFailure } from "./email-delivery-policy";
import type {
  ComposedOutboxEmail,
  EmailOutboxKind,
  EmailOutboxRepository,
  EmailOutboxRow,
  OutboxEmailComposer,
} from "./email-outbox";

export interface EmailDeliverySummary {
  delivered: number;
  retried: number;
  failed: number;
}

export interface DeliverPendingEmailsDependencies {
  repository: EmailOutboxRepository;
  composer: OutboxEmailComposer;
  sender: EmailSender;
  now(): number;
  logFailure(fields: { outboxId: string; kind: EmailOutboxKind; errorCode: string }): void;
  logStaleLease(fields: { outboxId: string }): void;
}

type SendAttempt =
  { sent: true } | { sent: false; missingSubject: true } | { sent: false; error: unknown };

async function composeAndSend(
  dependencies: DeliverPendingEmailsDependencies,
  row: EmailOutboxRow,
): Promise<SendAttempt> {
  try {
    const composed: ComposedOutboxEmail | null = await dependencies.composer.compose(row);
    if (!composed) {
      return { sent: false, missingSubject: true };
    }
    await dependencies.sender.send({ to: composed.to, ...composed.rendered });
    return { sent: true };
  } catch (error) {
    return { sent: false, error };
  }
}

export async function deliverPendingEmails(
  dependencies: DeliverPendingEmailsDependencies,
  input: { limit: number; timeBudgetMs: number },
): Promise<EmailDeliverySummary> {
  const summary: EmailDeliverySummary = { delivered: 0, retried: 0, failed: 0 };
  const startedAt = dependencies.now();

  for (let index = 0; index < input.limit; index += 1) {
    if (dependencies.now() - startedAt >= input.timeBudgetMs) {
      break;
    }

    const [row] = await dependencies.repository.claimDue(1);
    if (!row) {
      break;
    }
    if (!row.lockedUntil) {
      throw new Error("Claimed email outbox row has no lease");
    }

    const attempt = await composeAndSend(dependencies, row);

    if (attempt.sent) {
      const updated = await dependencies.repository.markSent(row.id, row.lockedUntil);
      if (!updated) {
        dependencies.logStaleLease({ outboxId: row.id });
        continue;
      }
      summary.delivered += 1;
      continue;
    }

    if ("missingSubject" in attempt) {
      const updated = await dependencies.repository.markFailed(
        row.id,
        row.lockedUntil,
        "SUBJECT_MISSING",
      );
      if (!updated) {
        dependencies.logStaleLease({ outboxId: row.id });
        continue;
      }
      dependencies.logFailure({ outboxId: row.id, kind: row.kind, errorCode: "SUBJECT_MISSING" });
      summary.failed += 1;
      continue;
    }

    const failure = classifyEmailDeliveryFailure(attempt.error, row.attempts);
    let updated: boolean;
    if (failure.action === "FAIL") {
      updated = await dependencies.repository.markFailed(
        row.id,
        row.lockedUntil,
        failure.errorCode,
      );
    } else {
      updated = await dependencies.repository.scheduleRetry(
        row.id,
        row.lockedUntil,
        failure.delaySeconds,
        failure.errorCode,
      );
    }
    if (!updated) {
      dependencies.logStaleLease({ outboxId: row.id });
      continue;
    }
    if (failure.action === "FAIL") {
      summary.failed += 1;
    } else {
      summary.retried += 1;
    }
    dependencies.logFailure({ outboxId: row.id, kind: row.kind, errorCode: failure.errorCode });
  }

  return summary;
}
