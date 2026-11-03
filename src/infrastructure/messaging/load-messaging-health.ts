import { cache } from "react";

import { getMessagingHealth, type MessagingHealth } from "@/application/messaging/messaging-health";
import { env } from "@/infrastructure/config/env";
import { postgresInstagramConnectionRepository } from "@/infrastructure/db/repositories/postgres-instagram-connection-repository";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";

// The admin layout and the Mensajes pages read it in the same request; cache runs it once.
export const loadMessagingHealth = cache((): Promise<MessagingHealth> =>
  getMessagingHealth({
    findConnectionExpiry: () => postgresInstagramConnectionRepository.findTokenExpiry(),
    messages: postgresMessageRepository,
    usesInstagram: env.MESSAGING_MODE === "instagram",
    now: new Date(),
  }),
);
