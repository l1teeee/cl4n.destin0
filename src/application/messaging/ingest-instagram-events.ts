import type { InstagramMessenger } from "./instagram-messenger";
import type { InstagramEventRepository } from "./instagram-event-ingestion";
import type { InstagramWebhookEvent } from "./instagram-events";

export interface InstagramIngestionDependencies {
  repository: InstagramEventRepository;
  messenger: InstagramMessenger;
  deliver(): Promise<void>;
  logFailure(fields: {
    messageId: string;
    kind: "profile" | "attachment";
    errorCode: string;
  }): void;
}

export interface InstagramIngestionResult {
  contactIdsNeedingProfile: string[];
  inboundImageMessageIds: string[];
  becameQueued: boolean;
  after(): Promise<void>;
}

function normalizedUsername(username: string | null): string | null {
  const value = username?.trim().replace(/^@/, "").toLowerCase() ?? null;
  return value && /^[a-z0-9._]{1,30}$/.test(value) ? value : null;
}

function normalizedName(name: string | null): string | null {
  const value = name?.trim() ?? null;
  return value ? value.slice(0, 120) : null;
}

export async function ingestInstagramEvents(
  dependencies: InstagramIngestionDependencies,
  events: readonly InstagramWebhookEvent[],
  options: { knownUsernames?: Readonly<Record<string, string>> } = {},
): Promise<InstagramIngestionResult> {
  const transaction = await dependencies.repository.ingestEvents(events, options.knownUsernames);

  return {
    contactIdsNeedingProfile: transaction.contacts
      .filter((contact) => !contact.username)
      .map((contact) => contact.contactId),
    inboundImageMessageIds: [...new Set(transaction.images.map((image) => image.messageId))],
    becameQueued: transaction.becameQueued,
    async after() {
      for (const contact of transaction.contacts) {
        let username = normalizedUsername(contact.username);
        if (!username) {
          try {
            const profile = await dependencies.messenger.fetchProfile(contact.recipientId);
            username = normalizedUsername(profile.username);
            await dependencies.repository.storeProfile(
              contact.contactId,
              username,
              normalizedName(profile.name),
            );
          } catch {
            dependencies.logFailure({
              messageId: contact.contactId,
              kind: "profile",
              errorCode: "PROFILE_FETCH_FAILED",
            });
            continue;
          }
        }
        if (username) await dependencies.repository.linkByUsername(contact.contactId, username);
      }

      for (const image of transaction.images) {
        try {
          const downloaded = await dependencies.messenger.downloadImage(image.url);
          await dependencies.repository.storeAttachment({
            messageId: image.messageId,
            position: image.position,
            ...downloaded,
          });
        } catch {
          dependencies.logFailure({
            messageId: image.messageId,
            kind: "attachment",
            errorCode: "ATTACHMENT_DOWNLOAD_FAILED",
          });
        }
      }

      await dependencies.deliver();
    },
  };
}
