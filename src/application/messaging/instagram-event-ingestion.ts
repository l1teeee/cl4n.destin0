import type { InstagramWebhookEvent } from "./instagram-events";

export interface InboundImageReference {
  messageId: string;
  position: number;
  url: string;
}

export interface IngestedContactReference {
  contactId: string;
  recipientId: string;
  username: string | null;
}

export interface InstagramIngestionTransactionResult {
  contacts: IngestedContactReference[];
  images: InboundImageReference[];
  becameQueued: boolean;
}

export interface InstagramEventRepository {
  ingestEvents(
    events: readonly InstagramWebhookEvent[],
    ownAccountId: string | null,
    knownUsernames?: Readonly<Record<string, string>>,
  ): Promise<InstagramIngestionTransactionResult>;
  storeProfile(
    contactId: string,
    username: string | null,
    displayName: string | null,
  ): Promise<void>;
  linkByUsername(contactId: string, username: string): Promise<boolean>;
  storeAttachment(input: {
    messageId: string;
    position: number;
    contentType: string;
    data: Buffer;
  }): Promise<void>;
  listMissingInboundImages(limit: number): Promise<InboundImageReference[]>;
  markAttachmentPermanentlyFailed(messageId: string, position: number): Promise<void>;
}
