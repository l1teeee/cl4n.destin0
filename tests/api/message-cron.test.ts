import { beforeEach, describe, expect, it, vi } from "vitest";

const drain = vi.fn();
const retryImages = vi.fn();
const secret = "cron-secret-with-at-least-32-characters";

vi.mock("@/infrastructure/config/env", () => ({ env: { CRON_SECRET: secret } }));
vi.mock("@/infrastructure/messaging/drain-message-outbox", () => ({
  drainMessageOutbox: drain,
}));
vi.mock("@/infrastructure/messaging/ingest-instagram-events", () => ({
  retryConfiguredInboundImages: retryImages,
}));

const { GET } = await import("@/app/api/cron/messages/route");

beforeEach(() => {
  drain.mockReset().mockResolvedValue({ sent: 2, retried: 1, failed: 0 });
  retryImages.mockReset().mockResolvedValue(undefined);
});

describe("message cron route", () => {
  it.each([undefined, "Bearer wrong", secret, "Basic abc"])(
    "rejects invalid authorization %s",
    async (authorization) => {
      const response = await GET(
        new Request("http://localhost/api/cron/messages", {
          headers: authorization ? { authorization } : {},
        }),
      );
      expect(response.status).toBe(401);
      expect(drain).not.toHaveBeenCalled();
    },
  );

  it("drains 50 messages with the configured budget", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/messages", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(retryImages).toHaveBeenCalledWith(20);
    expect(drain).toHaveBeenCalledWith({ limit: 50, timeBudgetMs: 40_000 });
  });
});
