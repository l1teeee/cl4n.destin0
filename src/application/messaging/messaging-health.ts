import type { MessageKind } from "@/domain/messaging/message-types";

import type { InstagramConnection } from "./instagram-connection";

export type UnsentMessageStatus = "FAILED" | "WAITING_WINDOW" | "WAITING_CONTACT" | "RETRYING";

export interface UnsentMessage {
  id: string;
  status: UnsentMessageStatus;
  kind: MessageKind;
  body: string | null;
  attachmentCount: number;
  lastError: string | null;
  createdAt: Date;
  contactId: string | null;
  // The linked contact's username, else the Instagram handle typed in the request form.
  instagramUsername: string | null;
  // "full_name" or "full_name y guest2_full_name" of the request; null without a request.
  guestName: string | null;
  eventName: string | null;
  eventStartsAt: Date | null;
}

export interface UndeliveredCounts {
  failed: number;
  retrying: number;
}

export interface MessagingHealthRepository {
  countUndeliveredMessages(): Promise<UndeliveredCounts>;
  lastMetaSignalAt(): Promise<Date | null>;
  listUnsentMessages(limit: number): Promise<UnsentMessage[]>;
}

export type InstagramConnectionState = "CONNECTED" | "MISSING" | "EXPIRED" | "NOT_USED";

export interface MessagingHealth {
  connection: InstagramConnectionState;
  failedCount: number;
  retryingCount: number;
  lastMetaSignalAt: Date | null;
  failing: boolean;
}

export interface MessagingHealthDependencies {
  findConnection(): Promise<InstagramConnection | null>;
  messages: MessagingHealthRepository;
  // In "log" mode nothing goes through Instagram, so the connection does not matter.
  usesInstagram: boolean;
  now: Date;
}

function connectionState(
  usesInstagram: boolean,
  connection: InstagramConnection | null,
  now: Date,
): InstagramConnectionState {
  if (!usesInstagram) return "NOT_USED";
  if (connection === null) return "MISSING";
  return connection.tokenExpiresAt.getTime() <= now.getTime() ? "EXPIRED" : "CONNECTED";
}

export async function getMessagingHealth(
  dependencies: MessagingHealthDependencies,
): Promise<MessagingHealth> {
  const [connection, counts, lastMetaSignalAt] = await Promise.all([
    dependencies.usesInstagram ? dependencies.findConnection() : Promise.resolve(null),
    dependencies.messages.countUndeliveredMessages(),
    dependencies.messages.lastMetaSignalAt(),
  ]);
  const state = connectionState(dependencies.usesInstagram, connection, dependencies.now);
  const connectionBroken = state === "MISSING" || state === "EXPIRED";
  return {
    connection: state,
    failedCount: counts.failed,
    retryingCount: counts.retrying,
    lastMetaSignalAt,
    failing: connectionBroken || counts.failed > 0 || counts.retrying > 0,
  };
}

export function listUnsentMessages(
  repository: MessagingHealthRepository,
  limit: number,
): Promise<UnsentMessage[]> {
  return repository.listUnsentMessages(limit);
}
