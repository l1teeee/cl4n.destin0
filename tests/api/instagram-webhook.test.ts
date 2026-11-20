import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstagramConnection } from "@/application/messaging/instagram-connection";

const after = vi.fn((callback: () => unknown) => callback());
const followup = vi.fn();
const ingest = vi.fn();
const log = vi.fn();
const findConnection = vi.fn<() => Promise<InstagramConnection | null>>();
const fetchMock = vi.fn<typeof fetch>();
const mockedEnv = vi.hoisted(() => ({
  MESSAGING_MODE: "instagram" as "instagram" | "log",
  INSTAGRAM_APP_SECRET: "meta-app-secret-123456",
  META_APP_SECRET: "unified-app-secret-123456",
  META_WEBHOOK_VERIFY_TOKEN: "meta-verify-token-123456",
  DRMR_WEBHOOK_FORWARD_URL: undefined as string | undefined,
  INSTAGRAM_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_POOL_MAX: 2,
  DATABASE_SSL_MODE: "disable",
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@/infrastructure/config/env", () => ({ env: mockedEnv }));
vi.mock("@/infrastructure/db/repositories/postgres-instagram-connection-repository", () => ({
  postgresInstagramConnectionRepository: { find: findConnection },
}));
vi.mock("@/infrastructure/messaging/ingest-instagram-events", () => ({
  ingestConfiguredInstagramEvents: ingest,
}));
vi.mock("@/infrastructure/observability/logger", () => ({ log }));
vi.stubGlobal("fetch", fetchMock);

const { GET, POST } = await import("@/app/api/webhooks/instagram/route");

function signedRequest(body: string, signature?: string): Request {
  const valid = createHmac("sha256", "meta-app-secret-123456").update(body).digest("hex");
  return new Request("http://localhost/api/webhooks/instagram", {
    method: "POST",
    headers: { "x-hub-signature-256": signature ?? `sha256=${valid}` },
    body,
  });
}

beforeEach(() => {
  findConnection.mockReset().mockResolvedValue({
    accountId: "1000",
    username: "clandestino.sv",
    accessToken: "private-test-token",
    tokenExpiresAt: new Date("2027-01-01"),
    kind: "INSTAGRAM_LOGIN",
    tokenVersion: 1,
    connectedAt: new Date(),
    tokenRefreshedAt: new Date(),
    connectedByAdminId: null,
  });
  mockedEnv.MESSAGING_MODE = "instagram";
  mockedEnv.DRMR_WEBHOOK_FORWARD_URL = undefined;
  fetchMock.mockReset().mockImplementation(async () => new Response(null, { status: 200 }));
  followup.mockReset().mockResolvedValue(undefined);
  ingest
    .mockReset()
    .mockResolvedValue({ contacts: [], images: [], becameQueued: false, after: followup });
  after.mockClear();
  log.mockClear();
});

describe("Instagram webhook route", () => {
  it("answers the verification handshake as text", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=meta-verify-token-123456&hub.challenge=challenge-1",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe("challenge-1");
  });

  it("rejects an invalid verification token", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x",
      ),
    );
    expect(response.status).toBe(403);
  });

  it("returns 401 without signature details", async () => {
    const response = await POST(signedRequest('{"object":"instagram"}', "sha256=bad"));
    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("");
    expect(ingest).not.toHaveBeenCalled();
  });

  it("returns 404 for POST in log mode", async () => {
    mockedEnv.MESSAGING_MODE = "log";
    const response = await POST(signedRequest('{"object":"instagram"}'));
    expect(response.status).toBe(404);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("returns 413 above one megabyte", async () => {
    const response = await POST(signedRequest("x".repeat(1024 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("parses, ingests and defers network follow-up", async () => {
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "1000",
          messaging: [
            {
              sender: { id: "2000" },
              recipient: { id: "1000" },
              timestamp: 1_700_000_000_000,
              message: { mid: "m1", text: "hola" },
            },
          ],
        },
      ],
    });
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("EVENT_RECEIVED");
    expect(ingest).toHaveBeenCalledWith(
      [expect.objectContaining({ type: "inbound_message", externalMessageId: "m1" })],
      { ownAccountId: "1000", deadline: expect.any(Number) },
    );
    const deadline = ingest.mock.calls[0]![1].deadline as number;
    expect(deadline).toBeGreaterThan(Date.now() + 20_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 25_000);
    expect(after).toHaveBeenCalledOnce();
    expect(followup).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("info", "instagram_webhook_received", {
      events: 1,
      skipped: 0,
      foreignEntries: 0,
      unhandledFields: "",
    });
  });

  it("ingests a unified connection signed by the Meta app", async () => {
    const connection = await findConnection();
    findConnection.mockResolvedValue({
      ...connection!,
      kind: "UNIFIED_LOGIN",
      tokenExpiresAt: null,
    });
    const body = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: "1000",
          messaging: [
            {
              sender: { id: "2000" },
              recipient: { id: "1000" },
              timestamp: 1_700_000_000_000,
              message: { mid: "unified-mid", text: "hola" },
            },
          ],
          changes: [{ field: "unknown_field", value: "private-content" }],
        },
      ],
    });
    const signature = createHmac("sha256", mockedEnv.META_APP_SECRET).update(body).digest("hex");
    const response = await POST(signedRequest(body, `sha256=${signature}`));
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(
      [expect.objectContaining({ type: "inbound_message", externalMessageId: "unified-mid" })],
      { ownAccountId: "1000", deadline: expect.any(Number) },
    );
    expect(log).toHaveBeenCalledWith("info", "instagram_webhook_received", {
      events: 1,
      skipped: 1,
      foreignEntries: 0,
      unhandledFields: "unknown_field",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-content");
    expect(after).toHaveBeenCalledOnce();
  });

  it("acknowledges the old app without parsing or ingesting after a unified relink", async () => {
    const connection = await findConnection();
    findConnection.mockResolvedValue({
      ...connection!,
      kind: "UNIFIED_LOGIN",
      tokenExpiresAt: null,
    });
    const response = await POST(signedRequest("not-json"));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("EVENT_RECEIVED");
    expect(ingest).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("info", "instagram_webhook_other_app", {
      signedBy: "INSTAGRAM_LOGIN",
    });
    expect(log).not.toHaveBeenCalledWith("warn", "instagram_webhook_invalid_json");
  });

  it("ignores unified webhooks until the legacy connection is replaced", async () => {
    const body = '{"object":"instagram","entry":[]}';
    const signature = createHmac("sha256", mockedEnv.META_APP_SECRET).update(body).digest("hex");
    const response = await POST(signedRequest(body, `sha256=${signature}`));
    expect(response.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("info", "instagram_webhook_other_app", {
      signedBy: "UNIFIED_LOGIN",
    });
  });

  it("accepts the unified signature when no legacy secret is configured", async () => {
    const connection = await findConnection();
    findConnection.mockResolvedValue({
      ...connection!,
      kind: "UNIFIED_LOGIN",
      tokenExpiresAt: null,
    });
    const legacySecret = mockedEnv.INSTAGRAM_APP_SECRET;
    mockedEnv.INSTAGRAM_APP_SECRET = "";
    try {
      const body = '{"object":"instagram","entry":[]}';
      const signature = createHmac("sha256", mockedEnv.META_APP_SECRET).update(body).digest("hex");
      expect((await POST(signedRequest(body, `sha256=${signature}`))).status).toBe(200);
      expect(ingest).toHaveBeenCalledOnce();
    } finally {
      mockedEnv.INSTAGRAM_APP_SECRET = legacySecret;
    }
  });

  it("logs invalid JSON without exposing its body", async () => {
    const response = await POST(signedRequest("not-json"));
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith("warn", "instagram_webhook_invalid_json");
  });

  it("acknowledges without ingestion when no connection exists", async () => {
    findConnection.mockResolvedValue(null);
    const response = await POST(signedRequest('{"object":"instagram"}'));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("EVENT_RECEIVED");
    expect(ingest).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", "instagram_webhook_not_connected");
  });
});

describe("Instagram webhook forwarding", () => {
  const forwardUrl = "https://drmr.example/api/webhooks/instagram";
  const body = '{"object":"instagram","entry":[]}';

  it("forwards the exact signed body and signature when configured", async () => {
    mockedEnv.DRMR_WEBHOOK_FORWARD_URL = forwardUrl;
    const valid = createHmac("sha256", "meta-app-secret-123456").update(body).digest("hex");
    const signature = `sha256=${valid}`;
    const response = await POST(signedRequest(body, signature));
    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(forwardUrl);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-hub-signature-256"]).toBe(signature);
    expect(Buffer.from(init?.body as Uint8Array).toString("utf8")).toBe(body);
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith("info", "instagram_webhook_forwarded", { status: 200 }),
    );
  });

  it("does not forward an invalid signature", async () => {
    mockedEnv.DRMR_WEBHOOK_FORWARD_URL = forwardUrl;
    const response = await POST(signedRequest(body, "sha256=bad"));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not forward when no forward URL is set", async () => {
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps answering 200 when the forward fails", async () => {
    mockedEnv.DRMR_WEBHOOK_FORWARD_URL = forwardUrl;
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await POST(signedRequest(body));
    expect(response.status).toBe(200);
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith("warn", "instagram_webhook_forward_failed", {
        reason: "NETWORK",
      }),
    );
  });
});
