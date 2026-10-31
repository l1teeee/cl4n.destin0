import { describe, expect, it, vi } from "vitest";

import {
  deliverPendingMessages,
  type DeliverMessagesDependencies,
} from "@/application/messaging/deliver-messages";
import {
  MessengerError,
  type InstagramMessenger,
} from "@/application/messaging/instagram-messenger";
import type {
  DeliverableMessage,
  MessageDeliveryRepository,
} from "@/application/messaging/message-repository";
import type { MessageStatus } from "@/domain/messaging/message-types";

function row(changes: Partial<DeliverableMessage> = {}): DeliverableMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "FREE_TEXT",
    contactId: "00000000-0000-4000-8000-000000000002",
    recipientId: "1234",
    lastInboundAt: new Date("2026-10-30T11:00:00Z"),
    body: "hello",
    attachmentUrls: [],
    attempts: 1,
    lockedUntil: new Date("2026-10-30T12:02:00Z"),
    relevance: {
      reservationStatus: null,
      reservationStage: null,
      waitlistStatus: null,
      locationStatus: null,
      messageLocationRevision: null,
      currentLocationRevision: null,
      cluePresent: false,
    },
    ...changes,
  };
}

function setup(message: DeliverableMessage, sendError?: unknown) {
  let claimed = false;
  const states = new Map<string, MessageStatus>();
  const repository: MessageDeliveryRepository = {
    claimDue: vi.fn(async () => {
      if (claimed) return [];
      claimed = true;
      return [message];
    }),
    markDiscarded: vi.fn(async (id) => {
      states.set(id, "DISCARDED");
      return true;
    }),
    markWaitingWindow: vi.fn(async (id) => {
      states.set(id, "WAITING_WINDOW");
      return true;
    }),
    markSent: vi.fn(async (id) => {
      states.set(id, "SENT");
      return true;
    }),
    scheduleRetry: vi.fn(async (id) => {
      states.set(id, "QUEUED");
      return true;
    }),
    markFailed: vi.fn(async (id) => {
      states.set(id, "FAILED");
      return true;
    }),
    getStatus: vi.fn(async (id) => states.get(id) ?? null),
  };
  const messenger: InstagramMessenger = {
    sendText: vi.fn(async () => {
      if (sendError) throw sendError;
      return { messageId: "meta-1" };
    }),
    sendImage: vi.fn(async () => ({ messageId: "meta-image" })),
    fetchProfile: vi.fn(),
    downloadImage: vi.fn(),
  };
  const dependencies: DeliverMessagesDependencies = {
    repository,
    messenger,
    now: () => new Date("2026-10-30T12:00:00Z").getTime(),
    logFailure: vi.fn(),
    logStaleLease: vi.fn(),
  };
  return { dependencies, repository, messenger };
}

describe("message delivery", () => {
  it("sends text chunks followed by attachments and marks SENT with the last id", async () => {
    const message = row({ body: "hello world", attachmentUrls: ["https://example.com/a.jpg"] });
    const { dependencies, repository, messenger } = setup(message);
    const summary = await deliverPendingMessages(dependencies, { limit: 5, timeBudgetMs: 1000 });

    expect(summary.sent).toBe(1);
    expect(messenger.sendText).toHaveBeenCalledWith("1234", "hello world");
    expect(messenger.sendImage).toHaveBeenCalledWith("1234", "https://example.com/a.jpg");
    expect(repository.markSent).toHaveBeenCalledWith(message.id, message.lockedUntil, "meta-image");
  });

  it("moves a closed window without calling Meta", async () => {
    const message = row({ lastInboundAt: new Date("2026-10-29T00:00:00Z") });
    const { dependencies, repository, messenger } = setup(message);
    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });

    expect(summary.waitingWindow).toBe(1);
    expect(messenger.sendText).not.toHaveBeenCalled();
    expect(repository.markWaitingWindow).toHaveBeenCalled();
  });

  it("moves a Meta outside-window error to WAITING_WINDOW", async () => {
    const message = row();
    const { dependencies, repository } = setup(
      message,
      new MessengerError("outside window", { status: 400, code: 10, subcode: 2534022 }),
    );
    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });
    expect(summary.waitingWindow).toBe(1);
    expect(repository.markWaitingWindow).toHaveBeenCalledWith(
      message.id,
      message.lockedUntil,
      "META_WINDOW_CLOSED",
    );
  });

  it("retries a 500 and fails a 400", async () => {
    const retry = setup(row(), new MessengerError("server", { status: 500 }));
    expect(
      await deliverPendingMessages(retry.dependencies, { limit: 1, timeBudgetMs: 1000 }),
    ).toMatchObject({ retried: 1 });

    const fail = setup(
      row({ id: "00000000-0000-4000-8000-000000000003" }),
      new MessengerError("bad", { status: 400, code: 42 }),
    );
    expect(
      await deliverPendingMessages(fail.dependencies, { limit: 1, timeBudgetMs: 1000 }),
    ).toMatchObject({ failed: 1 });
  });

  it("discards a message that is no longer relevant", async () => {
    const message = row({
      kind: "PAID",
      relevance: {
        reservationStatus: "CANCELLED",
        reservationStage: "PAID",
        waitlistStatus: null,
        locationStatus: null,
        messageLocationRevision: null,
        currentLocationRevision: null,
        cluePresent: false,
      },
    });
    const { dependencies, repository, messenger } = setup(message);
    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });
    expect(summary.discarded).toBe(1);
    expect(repository.markDiscarded).toHaveBeenCalledWith(
      message.id,
      message.lockedUntil,
      "NOT_RELEVANT",
    );
    expect(messenger.sendText).not.toHaveBeenCalled();
  });

  it("logs a stale lease without counting a completion", async () => {
    const message = row();
    const { dependencies, repository } = setup(message);
    vi.mocked(repository.markSent).mockResolvedValue(false);
    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });
    expect(summary.sent).toBe(0);
    expect(dependencies.logStaleLease).toHaveBeenCalledWith({ messageId: message.id });
  });
});
