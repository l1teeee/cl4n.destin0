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
    partsSent: 0,
    externalPartIds: [],
    lockedUntil: new Date("2026-10-30T12:02:00Z"),
    relevance: {
      reservationStatus: null,
      reservationStage: null,
      waitlistStatus: null,
      locationStatus: null,
      messageLocationRevision: null,
      currentLocationRevision: null,
      cluePresent: false,
      eventStatus: null,
      eventDeleted: false,
    },
    ...changes,
  };
}

function setup(message: DeliverableMessage, sendError?: unknown) {
  let claimed = false;
  const states = new Map<string, MessageStatus>();
  const repository: MessageDeliveryRepository = {
    repairWaitingContacts: vi.fn(async () => 0),
    claimDue: vi.fn(async () => {
      if (claimed) return [];
      claimed = true;
      return [message];
    }),
    extendLease: vi.fn(async (_id, lease) => new Date(lease.getTime() + 1000)),
    releaseClaim: vi.fn(async () => true),
    markDiscarded: vi.fn(async (id) => {
      states.set(id, "DISCARDED");
      return true;
    }),
    markWaitingWindow: vi.fn(async (id) => {
      states.set(id, "WAITING_WINDOW");
      return true;
    }),
    recordPart: vi.fn(async (id, _lease, _mid, lastPart) => {
      if (lastPart) states.set(id, "SENT");
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
    expect(repository.recordPart).toHaveBeenLastCalledWith(
      message.id,
      expect.any(Date),
      "meta-image",
      true,
    );
  });

  it("moves a closed window without calling Meta", async () => {
    const message = row({ lastInboundAt: new Date("2026-10-29T00:00:00Z") });
    const { dependencies, repository, messenger } = setup(message);
    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });

    expect(summary.waitingWindow).toBe(1);
    expect(messenger.sendText).not.toHaveBeenCalled();
    expect(repository.markWaitingWindow).toHaveBeenCalled();
  });

  it.each([
    {
      name: "an empty message",
      message: row({ body: null, attachmentUrls: [] }),
      errorCode: "EMPTY_MESSAGE",
    },
    {
      name: "delivery progress beyond the available parts",
      message: row({ partsSent: 1 }),
      errorCode: "PARTS_MISMATCH",
    },
    {
      name: "more than twenty parts",
      message: row({ body: null, attachmentUrls: Array.from({ length: 21 }, (_, i) => `${i}`) }),
      errorCode: "TOO_MANY_PARTS",
    },
  ])("fails $name without calling Meta", async ({ message, errorCode }) => {
    const { dependencies, repository, messenger } = setup(message);

    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });

    expect(summary.failed).toBe(1);
    expect(repository.markFailed).toHaveBeenCalledWith(message.id, message.lockedUntil, errorCode);
    expect(messenger.sendText).not.toHaveBeenCalled();
    expect(messenger.sendImage).not.toHaveBeenCalled();
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
      expect.any(Date),
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

  it("fails permanently when Meta omits message_id from a 200 response", async () => {
    const message = row();
    const { dependencies, repository, messenger } = setup(message);
    vi.mocked(messenger.sendText).mockResolvedValue({ messageId: "" });

    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });

    expect(summary.failed).toBe(1);
    expect(repository.markFailed).toHaveBeenCalledWith(
      message.id,
      expect.any(Date),
      "META_NO_MESSAGE_ID",
    );
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
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
        eventStatus: "SCHEDULED",
        eventDeleted: false,
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
    vi.mocked(repository.recordPart).mockResolvedValue(false);
    const summary = await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });
    expect(summary.sent).toBe(0);
    expect(dependencies.logStaleLease).toHaveBeenCalledWith({ messageId: message.id });
  });

  it("resumes at the first unrecorded part after a messenger failure", async () => {
    const body = `${"a".repeat(1000)} ${"b".repeat(10)}`;
    const first = row({ body });
    const firstRun = setup(first);
    vi.mocked(firstRun.messenger.sendText)
      .mockResolvedValueOnce({ messageId: "part-1" })
      .mockRejectedValueOnce(new MessengerError("server", { status: 500 }));

    await deliverPendingMessages(firstRun.dependencies, { limit: 1, timeBudgetMs: 1000 });
    expect(firstRun.repository.recordPart).toHaveBeenCalledWith(
      first.id,
      expect.any(Date),
      "part-1",
      false,
    );

    const retry = setup(row({ body, partsSent: 1, externalPartIds: ["part-1"] }));
    await deliverPendingMessages(retry.dependencies, { limit: 1, timeBudgetMs: 1000 });
    expect(retry.messenger.sendText).toHaveBeenCalledOnce();
    expect(retry.messenger.sendText).toHaveBeenCalledWith("1234", "bbbbbbbbbb");
  });

  it("extends the lease before every slow messenger call", async () => {
    const message = row({ body: "text", attachmentUrls: ["https://example.com/image"] });
    const { dependencies, repository } = setup(message);

    await deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 });

    expect(repository.extendLease).toHaveBeenCalledTimes(2);
    expect(repository.recordPart).toHaveBeenCalledTimes(2);
  });

  it("stops between parts at the deadline and releases the claim without progress", async () => {
    const message = row({ body: `${"a".repeat(1000)} ${"b".repeat(10)}` });
    const { dependencies, repository, messenger } = setup(message);
    let currentTime = 0;
    dependencies.now = vi.fn(() => currentTime);
    vi.mocked(repository.recordPart).mockImplementation(async () => {
      currentTime = 1_000;
      return true;
    });

    const summary = await deliverPendingMessages(dependencies, {
      limit: 1,
      timeBudgetMs: 1_000,
    });

    expect(summary.sent).toBe(0);
    expect(messenger.sendText).toHaveBeenCalledOnce();
    expect(repository.releaseClaim).toHaveBeenCalledWith(message.id, expect.any(Date));
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it("propagates a recorder failure without scheduling a resend", async () => {
    const message = row();
    const { dependencies, repository } = setup(message);
    vi.mocked(repository.recordPart).mockRejectedValue(new Error("database unavailable"));

    await expect(
      deliverPendingMessages(dependencies, { limit: 1, timeBudgetMs: 1000 }),
    ).rejects.toThrow("database unavailable");
    expect(repository.scheduleRetry).not.toHaveBeenCalled();
    expect(repository.markFailed).not.toHaveBeenCalled();
  });
});
