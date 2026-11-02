import { z } from "zod";

import type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";

export type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";

const idSchema = z.string().regex(/^\d{1,32}$/);
const actorSchema = z.object({ id: idSchema }).passthrough();
const attachmentSchema = z
  .object({
    type: z.string(),
    payload: z.object({ url: z.string().url().optional() }).passthrough().optional(),
  })
  .passthrough();
const messagingItemSchema = z
  .object({
    sender: actorSchema,
    recipient: actorSchema,
    timestamp: z.number().finite(),
    message: z
      .object({
        mid: z.string().min(1).optional(),
        text: z.string().optional(),
        attachments: z.array(z.unknown()).optional(),
        is_echo: z.boolean().optional(),
        is_deleted: z.boolean().optional(),
        is_unsupported: z.boolean().optional(),
        quick_reply: z.object({ payload: z.string() }).passthrough().optional(),
        referral: z.object({ ref: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    read: z
      .object({ mid: z.string().min(1) })
      .passthrough()
      .optional(),
    referral: z.object({ ref: z.string().optional() }).passthrough().optional(),
    reaction: z
      .object({ mid: z.string().min(1) })
      .passthrough()
      .optional(),
    postback: z
      .object({ mid: z.string().min(1) })
      .passthrough()
      .optional(),
    message_edit: z
      .object({
        mid: z.string().min(1),
        text: z.string(),
        num_edit: z.union([z.string(), z.number()]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const payloadSchema = z
  .object({
    object: z.literal("instagram"),
    entry: z.array(
      z
        .object({
          id: idSchema,
          messaging: z.array(z.unknown()).optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export interface ParsedInstagramWebhook {
  events: InstagramWebhookEvent[];
  skipped: number;
  foreignEntries: number;
}

function eventDate(value: number): Date {
  return new Date(value < 1_000_000_000_000 ? value * 1000 : value);
}

// Only images are shown in the admin chat; reels, shares, videos, audio, files and stickers are
// dropped so the message falls back to the unsupported-content placeholder.
function imageAttachmentUrls(message: z.infer<typeof messagingItemSchema>["message"]): string[] {
  return (message?.attachments ?? [])
    .flatMap((candidate) => {
      const parsed = attachmentSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.type !== "image" || !parsed.data.payload?.url) return [];
      try {
        const url = new URL(parsed.data.payload.url);
        return url.protocol === "https:" ? [parsed.data.payload.url] : [];
      } catch {
        return [];
      }
    })
    .slice(0, 10);
}

function normalizeItem(
  item: z.infer<typeof messagingItemSchema>,
  accountId: string,
): InstagramWebhookEvent | null {
  const timestamp = eventDate(item.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  if (item.message_edit) {
    return {
      type: "message_edit",
      timestamp,
      externalMessageId: item.message_edit.mid,
      text: item.message_edit.text,
    };
  }

  if (item.message?.mid) {
    if (item.message.is_deleted) {
      if (item.message.is_echo || item.sender.id === accountId) return null;
      return {
        type: "deleted",
        timestamp,
        senderId: item.sender.id,
        externalMessageId: item.message.mid,
      };
    }
    const imageUrls = imageAttachmentUrls(item.message);
    if (item.message.is_echo) {
      return {
        type: "echo",
        timestamp,
        externalMessageId: item.message.mid,
        recipientId: item.recipient.id,
        text: item.message.text ?? null,
        attachmentUrls: imageUrls,
      };
    }
    return {
      type: "inbound_message",
      timestamp,
      externalMessageId: item.message.mid,
      senderId: item.sender.id,
      text: item.message.text ? [...item.message.text].slice(0, 2000).join("") : null,
      attachmentUrls: imageUrls,
      imageAttachmentUrls: imageUrls,
      quickReplyPayload: item.message.quick_reply?.payload ?? null,
      referralRef: item.message.referral?.ref ?? null,
    };
  }
  if (item.read) {
    return {
      type: "read",
      timestamp,
      senderId: item.sender.id,
      externalMessageId: item.read.mid,
    };
  }
  if (item.referral) {
    return item.referral.ref
      ? { type: "referral", timestamp, senderId: item.sender.id, ref: item.referral.ref }
      : { type: "window_signal", timestamp, senderId: item.sender.id };
  }
  if (item.reaction || item.postback) {
    return { type: "window_signal", timestamp, senderId: item.sender.id };
  }
  return null;
}

export function parseInstagramWebhook(payload: unknown, accountId: string): ParsedInstagramWebhook {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { events: [], skipped: 1, foreignEntries: 0 };

  const events: InstagramWebhookEvent[] = [];
  let skipped = 0;
  let foreignEntries = 0;
  for (const entry of parsed.data.entry) {
    if (entry.id !== accountId) {
      foreignEntries += 1;
      continue;
    }
    for (const candidate of entry.messaging ?? []) {
      const item = messagingItemSchema.safeParse(candidate);
      if (!item.success) {
        skipped += 1;
        continue;
      }
      const normalized = normalizeItem(item.data, accountId);
      if (normalized) events.push(normalized);
      else skipped += 1;
    }
  }
  return { events, skipped, foreignEntries };
}
