import type { AdminMessageRepository, MessageSubject } from "./admin-message-repository";
import type { MessageDeliverySummary } from "./deliver-messages";

export interface SendFreeTextDependencies {
  repository: AdminMessageRepository;
  consumeRateLimit(adminId: string): Promise<{ allowed: boolean }>;
  deliver(messageIds: readonly string[]): Promise<MessageDeliverySummary>;
}

export type SendFreeTextResult =
  | { ok: true; messageId: string; status: string; lastError: string | null }
  | { ok: false; error: "INVALID_TEXT" | "CONTACT_NOT_FOUND" | "RATE_LIMITED" };

export async function sendFreeText(
  dependencies: SendFreeTextDependencies,
  contactId: string,
  text: string,
  adminId: string,
): Promise<SendFreeTextResult> {
  const normalizedText = text.trim();
  if (normalizedText.length < 1 || normalizedText.length > 1000) {
    return { ok: false, error: "INVALID_TEXT" };
  }
  const rateLimit = await dependencies.consumeRateLimit(adminId);
  if (!rateLimit.allowed) return { ok: false, error: "RATE_LIMITED" };

  const messageId = await dependencies.repository.createFreeText(
    contactId,
    normalizedText,
    adminId,
  );
  if (!messageId) return { ok: false, error: "CONTACT_NOT_FOUND" };
  const summary = await dependencies.deliver([messageId]);
  const state = await dependencies.repository.getDeliveryState(messageId);
  const status = summary.outcomes[messageId] ?? state?.status ?? "QUEUED";
  return { ok: true, messageId, status, lastError: state?.lastError ?? null };
}

export function retryMessage(repository: AdminMessageRepository, id: string): Promise<boolean> {
  return repository.retryMessage(id);
}

export function markSentManually(
  repository: AdminMessageRepository,
  id: string,
  adminId: string,
): Promise<boolean> {
  return repository.markSentManually(id, adminId);
}

export function discardMessage(
  repository: AdminMessageRepository,
  id: string,
  adminId: string,
): Promise<boolean> {
  return repository.discardMessage(id, adminId);
}

export function linkContact(
  repository: AdminMessageRepository,
  contactId: string,
  subject: MessageSubject,
  adminId: string,
): Promise<boolean> {
  return repository.linkContact(contactId, subject, adminId);
}

export function unlinkContact(
  repository: AdminMessageRepository,
  contactId: string,
  subject: MessageSubject,
  adminId: string,
): Promise<boolean> {
  return repository.unlinkContact(contactId, subject, adminId);
}

export function markConversationRead(
  repository: AdminMessageRepository,
  contactId: string,
): Promise<boolean> {
  return repository.markConversationRead(contactId);
}
