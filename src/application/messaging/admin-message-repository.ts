import type { MessageStatus } from "@/domain/messaging/message-types";

export type MessageSubject = { reservationId: string } | { waitlistEntryId: string };

export interface AdminMessageRepository {
  createFreeText(contactId: string, text: string, adminId: string): Promise<string | null>;
  retryMessage(id: string): Promise<boolean>;
  markSentManually(id: string, adminId: string): Promise<boolean>;
  discardMessage(id: string, adminId: string): Promise<boolean>;
  linkContact(contactId: string, subject: MessageSubject, adminId: string): Promise<boolean>;
  unlinkContact(contactId: string, subject: MessageSubject, adminId: string): Promise<boolean>;
  markConversationRead(contactId: string): Promise<boolean>;
  getStatus(id: string): Promise<MessageStatus | null>;
  getDeliveryState(id: string): Promise<{ status: MessageStatus; lastError: string | null } | null>;
}
