import {
  deliverPendingEmails,
  type EmailDeliverySummary,
} from "@/application/notifications/deliver-pending-emails";

import { log } from "../../observability/logger";
import { emailSender } from "../email-sender";
import { postgresOutboxEmailComposer } from "./outbox-email-composer";
import { postgresEmailOutboxRepository } from "./postgres-email-outbox-repository";

export function drainEmailOutbox(input: {
  limit: number;
  timeBudgetMs: number;
}): Promise<EmailDeliverySummary> {
  return deliverPendingEmails(
    {
      repository: postgresEmailOutboxRepository,
      composer: postgresOutboxEmailComposer,
      sender: emailSender,
      now: Date.now,
      logFailure: (fields) => log("error", "email_delivery_failed", fields),
      logStaleLease: (fields) => log("warn", "email_outbox_stale_lease", fields),
    },
    input,
  );
}
