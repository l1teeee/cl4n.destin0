interface EventBase {
  timestamp: Date;
}

export type InstagramWebhookEvent =
  | (EventBase & {
      type: "inbound_message";
      externalMessageId: string;
      senderId: string;
      text: string | null;
      attachmentUrls: string[];
      imageAttachmentUrls: string[];
      quickReplyPayload: string | null;
      referralRef: string | null;
    })
  | (EventBase & {
      type: "echo";
      externalMessageId: string;
      recipientId: string;
      text: string | null;
      attachmentUrls: string[];
    })
  | (EventBase & { type: "deleted"; externalMessageId: string })
  | (EventBase & { type: "read"; senderId: string; externalMessageId: string })
  | (EventBase & { type: "referral"; senderId: string; ref: string })
  | (EventBase & { type: "window_signal"; senderId: string })
  | (EventBase & { type: "message_edit"; externalMessageId: string; text: string });
