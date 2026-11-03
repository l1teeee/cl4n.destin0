import type { MessageStatus } from "@/domain/messaging/message-types";

export type MessageSubject = { reservationId: string } | { waitlistEntryId: string };
export type AdminMessageMutationResult = "UPDATED" | "LIVE_LEASE" | "NOT_UPDATED";

export interface AdminMessageRepository {
  createFreeText(contactId: string, text: string, adminId: string): Promise<string | null>;
  recordManualFreeText(contactId: string, text: string, adminId: string): Promise<string | null>;
  retryMessage(id: string): Promise<AdminMessageMutationResult>;
  markSentManually(id: string, adminId: string): Promise<AdminMessageMutationResult>;
  discardMessage(id: string, adminId: string): Promise<AdminMessageMutationResult>;
  linkContact(contactId: string, subject: MessageSubject, adminId: string): Promise<boolean>;
  linkContactByCode(contactId: string, code: string, adminId: string): Promise<number>;
  unlinkContact(
    contactId: string,
    subject: MessageSubject,
    adminId: string,
  ): Promise<AdminMessageMutationResult>;
  isBlockedByWaitingWindow(id: string): Promise<boolean>;
  markConversationRead(contactId: string): Promise<boolean>;
  getStatus(id: string): Promise<MessageStatus | null>;
  getDeliveryState(id: string): Promise<{ status: MessageStatus; lastError: string | null } | null>;
}
