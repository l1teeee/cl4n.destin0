import type {
  AdminMessageMutationResult,
  AdminMessageRepository,
  MessageSubject,
} from "./admin-message-repository";
import type { MessageDeliverySummary } from "./deliver-messages";

function normalizedFreeText(text: string): string | null {
  const normalized = text.trim();
  return normalized.length >= 1 && normalized.length <= 1000 ? normalized : null;
}

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
  const normalizedText = normalizedFreeText(text);
  if (normalizedText === null) return { ok: false, error: "INVALID_TEXT" };
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

export interface RecordManualMessageDependencies {
  repository: AdminMessageRepository;
  consumeRateLimit(adminId: string): Promise<{ allowed: boolean }>;
}

export type RecordManualMessageResult =
  | { ok: true; messageId: string }
  | { ok: false; error: "INVALID_TEXT" | "CONTACT_NOT_FOUND" | "RATE_LIMITED" };

// The admin already sent this text from the Instagram app: it is stored for the history and never delivered.
export async function recordManualMessage(
  dependencies: RecordManualMessageDependencies,
  contactId: string,
  text: string,
  adminId: string,
): Promise<RecordManualMessageResult> {
  const normalizedText = normalizedFreeText(text);
  if (normalizedText === null) return { ok: false, error: "INVALID_TEXT" };
  const rateLimit = await dependencies.consumeRateLimit(adminId);
  if (!rateLimit.allowed) return { ok: false, error: "RATE_LIMITED" };
  const messageId = await dependencies.repository.recordManualFreeText(
    contactId,
    normalizedText,
    adminId,
  );
  if (!messageId) return { ok: false, error: "CONTACT_NOT_FOUND" };
  return { ok: true, messageId };
}

export function retryMessage(
  repository: AdminMessageRepository,
  id: string,
): Promise<AdminMessageMutationResult> {
  return repository.retryMessage(id);
}

export function markSentManually(
  repository: AdminMessageRepository,
  id: string,
  adminId: string,
): Promise<AdminMessageMutationResult> {
  return repository.markSentManually(id, adminId);
}

export function discardMessage(
  repository: AdminMessageRepository,
  id: string,
  adminId: string,
): Promise<AdminMessageMutationResult> {
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
): Promise<AdminMessageMutationResult> {
  return repository.unlinkContact(contactId, subject, adminId);
}

export function linkContactByCode(
  repository: AdminMessageRepository,
  contactId: string,
  code: string,
  adminId: string,
): Promise<number> {
  return repository.linkContactByCode(contactId, code, adminId);
}

export function markConversationRead(
  repository: AdminMessageRepository,
  contactId: string,
): Promise<boolean> {
  return repository.markConversationRead(contactId);
}
