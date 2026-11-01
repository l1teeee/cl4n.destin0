import { describe, expect, it, vi } from "vitest";

import {
  ingestInstagramEvents,
  retryInboundImages,
} from "@/application/messaging/ingest-instagram-events";
import type { InstagramEventRepository } from "@/application/messaging/instagram-event-ingestion";
import { MessengerError } from "@/application/messaging/instagram-messenger";

function repository(changes: Partial<InstagramEventRepository> = {}): InstagramEventRepository {
  return {
    ingestEvents: vi.fn(async () => ({ contacts: [], images: [], becameQueued: false })),
    storeProfile: vi.fn(async () => undefined),
    linkByUsername: vi.fn(async () => false),
    storeAttachment: vi.fn(async () => undefined),
    listMissingInboundImages: vi.fn(async () => []),
    markAttachmentPermanentlyFailed: vi.fn(async () => undefined),
    ...changes,
  };
}

describe("Instagram ingestion follow-up", () => {
  it("downloads no more than four images concurrently", async () => {
    const images = Array.from({ length: 8 }, (_, index) => ({
      messageId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      position: 0,
      url: `https://lookaside.fbsbx.com/${index}`,
    }));
    const messageRepository = repository({
      listMissingInboundImages: vi.fn(async () => images),
    });
    let active = 0;
    let maximumActive = 0;
    const downloadImage = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { contentType: "image/png", data: Buffer.from("png") };
    });

    await retryInboundImages(
      {
        repository: messageRepository,
        messenger: {
          sendText: vi.fn(),
          sendImage: vi.fn(),
          fetchProfile: vi.fn(),
          downloadImage,
        },
        logFailure: vi.fn(),
      },
      [],
      20,
    );

    expect(downloadImage).toHaveBeenCalledTimes(8);
    expect(maximumActive).toBe(4);
  });

  it.each([403, 404, 410])("marks CDN status %i as permanent", async (status) => {
    const image = {
      messageId: "00000000-0000-4000-8000-000000000001",
      position: 0,
      url: "https://lookaside.fbsbx.com/missing",
    };
    const messageRepository = repository({
      listMissingInboundImages: vi.fn(async () => [image]),
    });

    await retryInboundImages({
      repository: messageRepository,
      messenger: {
        sendText: vi.fn(),
        sendImage: vi.fn(),
        fetchProfile: vi.fn(),
        downloadImage: vi.fn(async () => {
          throw new MessengerError("missing", { status });
        }),
      },
      logFailure: vi.fn(),
    });

    expect(messageRepository.markAttachmentPermanentlyFailed).toHaveBeenCalledWith(
      image.messageId,
      image.position,
    );
  });

  it("does not start profile, image or delivery work after the deadline", async () => {
    const messageRepository = repository({
      ingestEvents: vi.fn(async () => ({
        contacts: [
          {
            contactId: "00000000-0000-4000-8000-000000000001",
            recipientId: "2000",
            username: null,
          },
        ],
        images: [
          {
            messageId: "00000000-0000-4000-8000-000000000002",
            position: 0,
            url: "https://lookaside.fbsbx.com/image",
          },
        ],
        becameQueued: true,
      })),
    });
    const fetchProfile = vi.fn();
    const downloadImage = vi.fn();
    const deliver = vi.fn(async () => undefined);
    const result = await ingestInstagramEvents(
      {
        repository: messageRepository,
        messenger: {
          sendText: vi.fn(),
          sendImage: vi.fn(),
          fetchProfile,
          downloadImage,
        },
        deliver,
        logFailure: vi.fn(),
      },
      [],
      { deadline: Date.now() - 1 },
    );

    await result.after();

    expect(fetchProfile).not.toHaveBeenCalled();
    expect(downloadImage).not.toHaveBeenCalled();
    expect(messageRepository.listMissingInboundImages).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
