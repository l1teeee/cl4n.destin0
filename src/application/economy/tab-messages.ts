import type { MessageDeliverySummary } from "@/application/messaging/deliver-messages";
import { groupTabMessageValues } from "@/domain/economy/tab-message";
import { renderMessageTemplate } from "@/domain/messaging/message-template";
import type { MessageStatus, TemplateKey } from "@/domain/messaging/message-types";
import type { PaymentSettings } from "@/domain/payment/payment-settings";

import type { EconomyGuest } from "./economy-repository";

export interface TabMessagePreview {
  reservationId: string;
  text: string;
  totalCents: number;
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
  const groups = new Map<string, EconomyGuest[]>();
  for (const guest of input.guests) {
    const group = groups.get(guest.reservationId) ?? [];
    group.push(guest);
    groups.set(guest.reservationId, group);
  }
  for (const [reservationId, group] of groups) {
    group.sort((a, b) => a.slot - b.slot);
    const people = group
      .filter((guest) => !guest.settled)
      .map((guest) => ({ ...guest, lines: guest.lines.filter((line) => line.voidedAt === null) }))
      .filter((guest) => guest.lines.length > 0);
    if (people.length === 0) continue;
    previews.push({
      reservationId,
      totalCents: people.reduce((total, person) => total + person.totalCents, 0),
      text: renderMessageTemplate(
        body,
        groupTabMessageValues({
          titularFullName: group[0]!.fullName,
          eventDate: input.eventDate,
          people,
          isCouple: group.length === 2,
          settings,
        }),
      ),
    });
  }
  return previews;
}

export async function sendGroupTabs(
  dependencies: SendTabMessageDependencies,
  command: {
    eventId: string;
    reservationIds: readonly string[] | null;
    previews: readonly TabMessagePreview[];
    adminId: string;
  },
): Promise<
  | { ok: true; sent: number; waiting: number; failed: number; skipped: number }
  | { ok: false; error: "RATE_LIMITED" | "NOTHING_TO_SEND" }
> {
  const chosen = command.previews.filter(
    (preview) =>
      command.reservationIds === null || command.reservationIds.includes(preview.reservationId),
  );
  if (chosen.length === 0) return { ok: false, error: "NOTHING_TO_SEND" };
  const rateLimit = await dependencies.consumeRateLimit(command.adminId);
  if (!rateLimit.allowed) return { ok: false, error: "RATE_LIMITED" };

  const ids: string[] = [];
  let skipped = 0;
  for (const preview of chosen) {
    const id = await dependencies.enqueueTabMessage({
      eventId: command.eventId,
      reservationId: preview.reservationId,
      text: preview.text,
      adminId: command.adminId,
    });
    if (id === null) skipped += 1;
    else ids.push(id);
  }
  const summary = await dependencies.deliver(ids);
  let sent = 0;
  let waiting = 0;
  let failed = 0;
  for (const id of ids) {
    const state = await dependencies.getDeliveryState(id);
    const status = summary.outcomes[id] ?? state?.status ?? "QUEUED";
    if (status === "SENT" || status === "READ" || status === "SENT_MANUALLY") sent += 1;
    else if (status === "QUEUED" || status === "WAITING_CONTACT" || status === "WAITING_WINDOW")
      waiting += 1;
    else failed += 1;
  }
  return { ok: true, sent, waiting, failed, skipped };
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
