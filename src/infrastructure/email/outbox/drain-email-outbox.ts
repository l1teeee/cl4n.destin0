import {
  deliverPendingEmails,
  type EmailDeliverySummary,
} from "@/application/notifications/deliver-pending-emails";

import { log } from "../../observability/logger";
import { emailSender } from "../email-sender";
import { postgresOutboxEmailComposer } from "./outbox-email-composer";
import { postgresEmailOutboxRepository } from "./postgres-email-outbox-repository";

export function drainEmailOutbox(input: { limit: number }): Promise<EmailDeliverySummary> {
  return deliverPendingEmails(
    {
      repository: postgresEmailOutboxRepository,
      composer: postgresOutboxEmailComposer,
      sender: emailSender,
      logFailure: (fields) => log("error", "email_delivery_failed", fields),
    },
    input,
  );
}
