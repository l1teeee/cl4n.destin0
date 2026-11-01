import { timingSafeEqual } from "node:crypto";

import { after } from "next/server";

import { env } from "@/infrastructure/config/env";
import { parseInstagramWebhook } from "@/infrastructure/instagram/instagram-webhook-parser";
import { isValidSignature } from "@/infrastructure/instagram/webhook-signature";
import { ingestConfiguredInstagramEvents } from "@/infrastructure/messaging/ingest-instagram-events";
import { log } from "@/infrastructure/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

async function readRawBody(request: Request): Promise<Buffer | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  if (!request.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = request.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode !== "subscribe" || !expected || !safeEqual(token, expected)) {
    return new Response(null, { status: 403 });
  }
  return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request): Promise<Response> {
  const followupDeadline = Date.now() + maxDuration * 1000 - 5_000;
  if (env.MESSAGING_MODE === "log") {
    log("info", "instagram_webhook_received", { events: 0, skipped: 0, foreignEntries: 0 });
    return new Response(null, { status: 404 });
  }

  const rawBody = await readRawBody(request);
  if (!rawBody) {
    log("info", "instagram_webhook_received", { events: 0, skipped: 1, foreignEntries: 0 });
    return new Response(null, { status: 413 });
  }
  if (
    !isValidSignature(rawBody, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET!)
  ) {
    log("info", "instagram_webhook_received", { events: 0, skipped: 1, foreignEntries: 0 });
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    log("warn", "instagram_webhook_invalid_json");
    log("info", "instagram_webhook_received", { events: 0, skipped: 1, foreignEntries: 0 });
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
  const parsed = parseInstagramWebhook(payload, env.INSTAGRAM_ACCOUNT_ID!);
  log("info", "instagram_webhook_received", {
    events: parsed.events.length,
    skipped: parsed.skipped,
    foreignEntries: parsed.foreignEntries,
  });
  const result = await ingestConfiguredInstagramEvents(parsed.events, {
    deadline: followupDeadline,
  });
  after(async () => {
    try {
      await result.after();
    } catch {
      log("error", "instagram_webhook_followup_failed");
    }
  });
  return new Response("EVENT_RECEIVED", { status: 200 });
}
