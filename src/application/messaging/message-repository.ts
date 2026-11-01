import type { MessageKind, MessageStatus } from "@/domain/messaging/message-types";
import type { MessageRelevanceState } from "@/domain/messaging/message-relevance";

export interface DeliverableMessage {
  id: string;
  kind: Exclude<MessageKind, "INBOUND">;
  contactId: string;
  recipientId: string;
  lastInboundAt: Date | null;
  body: string | null;
  attachmentUrls: string[];
  attempts: number;
  partsSent: number;
  externalPartIds: string[];
  lockedUntil: Date;
  relevance: MessageRelevanceState;
}

export interface MessageDeliveryRepository {
  repairWaitingContacts(): Promise<number>;
  claimDue(limit: number, messageIds?: readonly string[]): Promise<DeliverableMessage[]>;
  extendLease(id: string, lease: Date): Promise<Date | null>;
  markDiscarded(id: string, lease: Date, errorCode: string): Promise<boolean>;
  markWaitingWindow(id: string, lease: Date, errorCode?: string): Promise<boolean>;
  recordPart(
    id: string,
    lease: Date,
    externalMessageId: string,
    lastPart: boolean,
  ): Promise<boolean>;
  scheduleRetry(id: string, lease: Date, delaySeconds: number, errorCode: string): Promise<boolean>;
  markFailed(id: string, lease: Date, errorCode: string): Promise<boolean>;
  getStatus(id: string): Promise<MessageStatus | null>;
}
