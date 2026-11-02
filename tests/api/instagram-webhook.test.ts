import { createHmac } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptSecret } from "@/infrastructure/crypto/secret-box";

import { resetTestDatabase } from "../helpers/test-db";

const after = vi.fn((callback: () => unknown) => callback());
const followup = vi.fn();
const ingest = vi.fn();
const log = vi.fn();
const mockedEnv = vi.hoisted(() => ({
  MESSAGING_MODE: "instagram" as "instagram" | "log",
  INSTAGRAM_APP_SECRET: "meta-app-secret-123456",
  META_WEBHOOK_VERIFY_TOKEN: "meta-verify-token-123456",
  INSTAGRAM_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_POOL_MAX: 2,
  DATABASE_SSL_MODE: "disable",
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@/infrastructure/config/env", () => ({ env: mockedEnv }));
vi.mock("@/infrastructure/messaging/ingest-instagram-events", () => ({
  ingestConfiguredInstagramEvents: ingest,
}));
vi.mock("@/infrastructure/observability/logger", () => ({ log }));

const { GET, POST } = await import("@/app/api/webhooks/instagram/route");
const { pool } = await import("@/infrastructure/db/client");

beforeAll(async () => {
  await resetTestDatabase();
});

afterAll(async () => {
  await pool.end();
});

function signedRequest(body: string, signature?: string): Request {
  const valid = createHmac("sha256", "meta-app-secret-123456").update(body).digest("hex");
  return new Request("http://localhost/api/webhooks/instagram", {
    method: "POST",
    headers: { "x-hub-signature-256": signature ?? `sha256=${valid}` },
    body,
  });
}

beforeEach(async () => {
  await pool.query("DELETE FROM instagram_connection");
  await pool.query(
    `INSERT INTO instagram_connection (account_id, username, access_token_ciphertext, token_expires_at)
     VALUES ('1000', 'clandestino.sv', $1, now() + interval '60 days')`,
    [encryptSecret("private-test-token", Buffer.alloc(32, 7), "instagram_connection.access_token")],
  );
  mockedEnv.MESSAGING_MODE = "instagram";
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
    });
  });

  it("logs invalid JSON without exposing its body", async () => {
    const response = await POST(signedRequest("not-json"));
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith("warn", "instagram_webhook_invalid_json");
  });

  it("acknowledges without ingestion when no connection exists", async () => {
    await pool.query("DELETE FROM instagram_connection");
    const response = await POST(signedRequest('{"object":"instagram"}'));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("EVENT_RECEIVED");
    expect(ingest).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", "instagram_webhook_not_connected");
  });
});
