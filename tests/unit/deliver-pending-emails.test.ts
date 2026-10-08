import { describe, expect, it, vi } from "vitest";

import { deliverPendingEmails } from "@/application/notifications/deliver-pending-emails";
import { EmailDeliveryError } from "@/application/notifications/email-delivery-error";
import type {
  EmailOutboxRepository,
  EmailOutboxRow,
  OutboxEmailComposer,
} from "@/application/notifications/email-outbox";
import type { EmailSender } from "@/application/ports/email-sender";

function outboxRow(overrides: Partial<EmailOutboxRow> = {}): EmailOutboxRow {
  return {
    id: "row-1",
    kind: "RESERVATION_CONFIRMED",
    reservationId: "reservation-1",
    waitlistEntryId: null,
    adminUserId: null,
    payload: {},
    status: "PENDING",
    attempts: 1,
    nextAttemptAt: new Date(),
    lockedUntil: new Date(),
    lastError: null,
    sentAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function setup(rows: EmailOutboxRow[]) {
  const repository = {
    claimDue: vi.fn().mockResolvedValue(rows),
    markSent: vi.fn().mockResolvedValue(undefined),
    scheduleRetry: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
  const composer = {
    compose: vi.fn().mockResolvedValue({
      to: { email: "ana@example.com", name: "Ana" },
      rendered: { subject: "Asunto", html: "<p>Hola</p>", text: "Hola" },
    }),
  };
  const sender = { send: vi.fn<EmailSender["send"]>().mockResolvedValue(undefined) };
  const logFailure = vi.fn();

  return {
    repository,
    composer,
    sender,
    logFailure,
    run: (limit = 10) =>
      deliverPendingEmails(
        {
          repository: repository as unknown as EmailOutboxRepository,
          composer: composer as OutboxEmailComposer,
          sender,
          logFailure,
        },
        { limit },
      ),
  };
}

describe("deliverPendingEmails", () => {
  it("claims the requested limit and marks delivered rows as sent", async () => {
    const test = setup([outboxRow()]);

    await expect(test.run(7)).resolves.toEqual({ delivered: 1, retried: 0, failed: 0 });

    expect(test.repository.claimDue).toHaveBeenCalledWith(7);
    expect(test.sender.send).toHaveBeenCalledWith({
      to: { email: "ana@example.com", name: "Ana" },
      subject: "Asunto",
      html: "<p>Hola</p>",
      text: "Hola",
    });
    expect(test.repository.markSent).toHaveBeenCalledWith("row-1");
    expect(test.logFailure).not.toHaveBeenCalled();
  });

  it("schedules a retry with backoff on a transient failure", async () => {
    const test = setup([outboxRow({ attempts: 3 })]);
    test.sender.send.mockRejectedValue(new EmailDeliveryError(503, "busy"));

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 1, failed: 0 });

    expect(test.repository.scheduleRetry).toHaveBeenCalledWith("row-1", 240, "HTTP_503");
    expect(test.repository.markSent).not.toHaveBeenCalled();
    expect(test.logFailure).toHaveBeenCalledWith({
      outboxId: "row-1",
      kind: "RESERVATION_CONFIRMED",
      errorCode: "HTTP_503",
    });
  });

  it("fails permanently on a rejected request", async () => {
    const test = setup([outboxRow()]);
    test.sender.send.mockRejectedValue(new EmailDeliveryError(400, "bad address"));

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 0, failed: 1 });

    expect(test.repository.markFailed).toHaveBeenCalledWith("row-1", "HTTP_400");
    expect(test.repository.scheduleRetry).not.toHaveBeenCalled();
  });

  it("fails after the eighth attempt even for transient errors", async () => {
    const test = setup([outboxRow({ attempts: 8 })]);
    test.sender.send.mockRejectedValue(new EmailDeliveryError(null, "offline"));

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 0, failed: 1 });

    expect(test.repository.markFailed).toHaveBeenCalledWith("row-1", "NETWORK");
  });

  it("fails rows whose subject no longer exists without sending", async () => {
    const test = setup([outboxRow()]);
    test.composer.compose.mockResolvedValue(null);

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 0, failed: 1 });

    expect(test.sender.send).not.toHaveBeenCalled();
    expect(test.repository.markFailed).toHaveBeenCalledWith("row-1", "SUBJECT_MISSING");
    expect(test.logFailure).toHaveBeenCalledWith({
      outboxId: "row-1",
      kind: "RESERVATION_CONFIRMED",
      errorCode: "SUBJECT_MISSING",
    });
  });

  it("keeps delivering the remaining rows after one fails", async () => {
    const test = setup([outboxRow({ id: "a" }), outboxRow({ id: "b" })]);
    test.sender.send
      .mockRejectedValueOnce(new EmailDeliveryError(500, "boom"))
      .mockResolvedValueOnce(undefined);

    await expect(test.run()).resolves.toEqual({ delivered: 1, retried: 1, failed: 0 });

    expect(test.repository.scheduleRetry).toHaveBeenCalledWith("a", 60, "HTTP_500");
    expect(test.repository.markSent).toHaveBeenCalledWith("b");
  });

  it("never logs recipient, subject or body", async () => {
    const test = setup([outboxRow()]);
    test.sender.send.mockRejectedValue(new EmailDeliveryError(500, "ana@example.com Asunto"));

    await test.run();

    const logged = JSON.stringify(test.logFailure.mock.calls);
    expect(logged).not.toContain("ana@example.com");
    expect(logged).not.toContain("Asunto");
  });
});
