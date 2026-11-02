import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drain = vi.fn();
const retryImages = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
const secret = "cron-secret-with-at-least-32-characters";
const mockedEnv = { CRON_SECRET: secret, MESSAGING_MODE: "instagram" };

vi.mock("@/infrastructure/config/env", () => ({ env: mockedEnv }));
vi.mock("@/infrastructure/instagram/instagram-connection-runtime", () => ({
  refreshConfiguredInstagramToken: refresh,
}));
vi.mock("@/infrastructure/observability/logger", () => ({ log }));
vi.mock("@/infrastructure/messaging/drain-message-outbox", () => ({
  drainMessageOutbox: drain,
}));
vi.mock("@/infrastructure/messaging/ingest-instagram-events", () => ({
  retryConfiguredInboundImages: retryImages,
}));

const { GET } = await import("@/app/api/cron/messages/route");

beforeEach(() => {
  mockedEnv.MESSAGING_MODE = "instagram";
  refresh.mockReset().mockResolvedValue("NOT_CONNECTED");
  log.mockClear();
  drain.mockReset().mockResolvedValue({ sent: 2, retried: 1, failed: 0 });
  retryImages.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
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
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it("bounds image retries and drains with the remaining execution budget", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(6_000);
    const response = await GET(
      new Request("http://localhost/api/cron/messages", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(retryImages).toHaveBeenCalledWith(20, 16_000);
    expect(drain).toHaveBeenCalledWith({ limit: 50, timeBudgetMs: 45_000 });
    expect(log).toHaveBeenCalledWith("info", "instagram_token_refresh", {
      result: "NOT_CONNECTED",
    });
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      retryImages.mock.invocationCallOrder[0]!,
    );
  });

  it("continues delivery when refresh fails without logging secret details", async () => {
    refresh.mockRejectedValue(new Error("private-token"));
    const response = await GET(
      new Request("http://localhost/api/cron/messages", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(retryImages).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("error", "instagram_token_refresh_failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-token");
  });

  it("skips refresh in log mode", async () => {
    mockedEnv.MESSAGING_MODE = "log";
    const response = await GET(
      new Request("http://localhost/api/cron/messages", {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(refresh).not.toHaveBeenCalled();
  });
});
