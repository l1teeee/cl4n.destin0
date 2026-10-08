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
  const pending = [...rows];
  const repository = {
    claimDue: vi.fn(async () => pending.splice(0, 1)),
    markSent: vi.fn().mockResolvedValue(true),
    scheduleRetry: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
  };
  const composer = {
    compose: vi.fn().mockResolvedValue({
      to: { email: "ana@example.com", name: "Ana" },
      rendered: { subject: "Asunto", html: "<p>Hola</p>", text: "Hola" },
    }),
  };
  const sender = { send: vi.fn<EmailSender["send"]>().mockResolvedValue(undefined) };
  const now = vi.fn(() => 0);
  const logFailure = vi.fn();
  const logStaleLease = vi.fn();

  return {
    repository,
    composer,
    sender,
    now,
    logFailure,
    logStaleLease,
    run: (limit = 10, timeBudgetMs = 20_000) =>
      deliverPendingEmails(
        {
          repository: repository as unknown as EmailOutboxRepository,
          composer: composer as OutboxEmailComposer,
          sender,
          now,
          logFailure,
          logStaleLease,
        },
        { limit, timeBudgetMs },
      ),
  };
}

describe("deliverPendingEmails", () => {
  it("claims one row at a time and marks delivered rows as sent", async () => {
    const test = setup([outboxRow()]);

    await expect(test.run(7)).resolves.toEqual({ delivered: 1, retried: 0, failed: 0 });

    expect(test.repository.claimDue).toHaveBeenCalledWith(1);
    expect(test.sender.send).toHaveBeenCalledWith({
      to: { email: "ana@example.com", name: "Ana" },
      subject: "Asunto",
      html: "<p>Hola</p>",
      text: "Hola",
    });
    expect(test.repository.markSent).toHaveBeenCalledWith("row-1", expect.any(Date));
    expect(test.logFailure).not.toHaveBeenCalled();
  });

  it("schedules a retry with backoff on a transient failure", async () => {
    const test = setup([outboxRow({ attempts: 3 })]);
    test.sender.send.mockRejectedValue(new EmailDeliveryError(503, "busy"));

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 1, failed: 0 });

    expect(test.repository.scheduleRetry).toHaveBeenCalledWith(
      "row-1",
      expect.any(Date),
      240,
      "HTTP_503",
    );
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

    expect(test.repository.markFailed).toHaveBeenCalledWith("row-1", expect.any(Date), "HTTP_400");
    expect(test.repository.scheduleRetry).not.toHaveBeenCalled();
  });

  it("fails after the eighth attempt even for transient errors", async () => {
    const test = setup([outboxRow({ attempts: 8 })]);
    test.sender.send.mockRejectedValue(new EmailDeliveryError(null, "offline"));

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 0, failed: 1 });

    expect(test.repository.markFailed).toHaveBeenCalledWith("row-1", expect.any(Date), "NETWORK");
  });

  it("fails rows whose subject no longer exists without sending", async () => {
    const test = setup([outboxRow()]);
    test.composer.compose.mockResolvedValue(null);

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 0, failed: 1 });

    expect(test.sender.send).not.toHaveBeenCalled();
    expect(test.repository.markFailed).toHaveBeenCalledWith(
      "row-1",
      expect.any(Date),
      "SUBJECT_MISSING",
    );
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

    expect(test.repository.scheduleRetry).toHaveBeenCalledWith(
      "a",
      expect.any(Date),
      60,
      "HTTP_500",
    );
    expect(test.repository.markSent).toHaveBeenCalledWith("b", expect.any(Date));
  });

  it("stops before claiming another row when the time budget is exhausted", async () => {
    const test = setup([outboxRow({ id: "a" }), outboxRow({ id: "b" })]);
    test.now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(20_000);

    await expect(test.run(10, 20_000)).resolves.toEqual({
      delivered: 1,
      retried: 0,
      failed: 0,
    });

    expect(test.repository.claimDue).toHaveBeenCalledTimes(1);
    expect(test.repository.markSent).toHaveBeenCalledOnce();
    expect(test.repository.markSent).not.toHaveBeenCalledWith("b", expect.any(Date));
  });

  it("logs only the outbox id when a stale lease rejects completion", async () => {
    const test = setup([outboxRow()]);
    test.repository.markSent.mockResolvedValue(false);

    await expect(test.run()).resolves.toEqual({ delivered: 0, retried: 0, failed: 0 });

    expect(test.logStaleLease).toHaveBeenCalledWith({ outboxId: "row-1" });
    expect(test.logFailure).not.toHaveBeenCalled();
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
