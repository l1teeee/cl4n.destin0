import type { MessageKind, MessageSource, MessageStatus } from "@/domain/messaging/message-types";

export interface LinkedRequestSummary {
  id: string;
  type: "RESERVATION" | "WAITLIST_ENTRY";
  eventId: string;
  eventName: string;
  eventStartsAt: Date;
  guests: string[];
  instagramHandles: string[];
  status: string;
  stage: string | null;
}

export interface ConversationSummary {
  contactId: string;
  username: string | null;
  displayName: string | null;
  lastMessagePreview: string;
  lastActivityAt: Date;
  unreadCount: number;
  linkedRequests: LinkedRequestSummary[];
}

export interface ConversationMessage {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  kind: MessageKind;
  source: MessageSource;
  status: MessageStatus;
  body: string | null;
  attachmentIds: string[];
  attachmentUrls: string[];
  lastError: string | null;
  sentAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface ConversationDetail {
  contact: {
    id: string;
    username: string | null;
    displayName: string | null;
    lastInboundAt: Date | null;
    adminReadAt: Date | null;
  };
  linkedRequests: LinkedRequestSummary[];
  messages: ConversationMessage[];
}

export type RequestMessageSubject = { reservationId: string } | { waitlistEntryId: string };

export interface ConversationQueryRepository {
  listConversations(input: {
    search?: string;
    unlinkedOnly?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ items: ConversationSummary[]; total: number }>;
  getConversation(contactId: string): Promise<ConversationDetail | null>;
  countUnreadConversations(): Promise<number>;
  getRequestMessages(subject: RequestMessageSubject): Promise<ConversationMessage[]>;
}

export function listConversations(
  repository: ConversationQueryRepository,
  input: { search?: string; unlinkedOnly?: boolean; page: number; pageSize: number },
) {
  return repository.listConversations(input);
}

export function getConversation(repository: ConversationQueryRepository, contactId: string) {
  return repository.getConversation(contactId);
}

export function countUnreadConversations(repository: ConversationQueryRepository) {
  return repository.countUnreadConversations();
}

export function getRequestMessages(
  repository: ConversationQueryRepository,
  subject: RequestMessageSubject,
) {
  return repository.getRequestMessages(subject);
}
