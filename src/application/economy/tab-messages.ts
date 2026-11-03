import type { MessageDeliverySummary } from "@/application/messaging/deliver-messages";
import type { GuestSlot } from "@/domain/economy/consumption";
import { tabMessageValues } from "@/domain/economy/tab-message";
import { renderMessageTemplate } from "@/domain/messaging/message-template";
import type { MessageStatus, TemplateKey } from "@/domain/messaging/message-types";
import type { PaymentSettings } from "@/domain/payment/payment-settings";

import type { EconomyGuest } from "./economy-repository";

export interface TabMessagePreview {
  reservationId: string;
  slot: GuestSlot;
  text: string;
}

export interface TabMessagePreviewDependencies {
  findTemplateBody(key: TemplateKey): Promise<string | null>;
  findPaymentSettings(): Promise<PaymentSettings | null>;
}

// Null while the TAB template is missing (before migration 0019): the send button stays hidden.
export async function buildTabMessages(
  dependencies: TabMessagePreviewDependencies,
  input: { eventDate: string; guests: readonly EconomyGuest[] },
): Promise<TabMessagePreview[] | null> {
  const [body, settings] = await Promise.all([
    dependencies.findTemplateBody("TAB"),
    dependencies.findPaymentSettings(),
  ]);
  if (body === null) return null;

  const previews: TabMessagePreview[] = [];
  for (const guest of input.guests) {
    const activeLines = guest.lines.filter((line) => line.voidedAt === null);
    if (guest.settled || activeLines.length === 0) continue;
    previews.push({
      reservationId: guest.reservationId,
      slot: guest.slot,
      text: renderMessageTemplate(
        body,
        tabMessageValues({
          guestFullName: guest.fullName,
          eventDate: input.eventDate,
          lines: activeLines,
          totalCents: guest.totalCents,
          settings,
        }),
      ),
    });
  }
  return previews;
}

export interface SendTabMessageDependencies {
  consumeRateLimit(adminId: string): Promise<{ allowed: boolean }>;
  enqueueTabMessage(input: {
    eventId: string;
    reservationId: string;
    text: string;
    adminId: string;
  }): Promise<string | null>;
  deliver(messageIds: readonly string[]): Promise<MessageDeliverySummary>;
  getDeliveryState(id: string): Promise<{ status: MessageStatus; lastError: string | null } | null>;
}

export type SendTabMessageResult =
  | { ok: true; messageId: string; status: string; lastError: string | null }
  | { ok: false; error: "INVALID_TEXT" | "RATE_LIMITED" | "RESERVATION_NOT_FOUND" };

export async function sendTabMessage(
  dependencies: SendTabMessageDependencies,
  command: { eventId: string; reservationId: string; text: string; adminId: string },
): Promise<SendTabMessageResult> {
  const text = command.text.trim();
  if (text.length < 1 || text.length > 2000) return { ok: false, error: "INVALID_TEXT" };
  const rateLimit = await dependencies.consumeRateLimit(command.adminId);
  if (!rateLimit.allowed) return { ok: false, error: "RATE_LIMITED" };

  const messageId = await dependencies.enqueueTabMessage({ ...command, text });
  if (messageId === null) return { ok: false, error: "RESERVATION_NOT_FOUND" };
  const summary = await dependencies.deliver([messageId]);
  const state = await dependencies.getDeliveryState(messageId);
  const status = summary.outcomes[messageId] ?? state?.status ?? "QUEUED";
  return { ok: true, messageId, status, lastError: state?.lastError ?? null };
}
