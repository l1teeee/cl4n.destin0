import { beforeEach, describe, expect, it, vi } from "vitest";

const CRON_SECRET = "c".repeat(40);
const drainEmailOutbox = vi.fn();
const deleteSentOlderThan = vi.fn();

vi.mock("@/infrastructure/config/env", () => ({ env: { CRON_SECRET } }));
vi.mock("@/infrastructure/email/outbox/drain-email-outbox", () => ({ drainEmailOutbox }));
vi.mock("@/infrastructure/email/outbox/postgres-email-outbox-repository", () => ({
  postgresEmailOutboxRepository: { deleteSentOlderThan },
}));

const { GET } = await import("@/app/api/cron/email-outbox/route");

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/email-outbox", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  drainEmailOutbox.mockReset().mockResolvedValue({ delivered: 3, retried: 1, failed: 0 });
  deleteSentOlderThan.mockReset().mockResolvedValue(0);
});

describe("GET /api/cron/email-outbox", () => {
  it("rejects a request without the bearer secret", async () => {
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    expect(drainEmailOutbox).not.toHaveBeenCalled();
  });

  it.each(["Bearer wrong-secret", `Bearer ${CRON_SECRET}x`, CRON_SECRET, "Basic abc"])(
    "rejects the authorization header %s",
    async (authorization) => {
      const response = await GET(cronRequest(authorization));

      expect(response.status).toBe(401);
      expect(drainEmailOutbox).not.toHaveBeenCalled();
      expect(deleteSentOlderThan).not.toHaveBeenCalled();
    },
  );

  it("drains up to 50 rows, prunes old sent rows and reports the summary", async () => {
    const response = await GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ delivered: 3, retried: 1, failed: 0 });
    expect(drainEmailOutbox).toHaveBeenCalledWith({ limit: 50 });
    expect(deleteSentOlderThan).toHaveBeenCalledWith(90);
  });
});
