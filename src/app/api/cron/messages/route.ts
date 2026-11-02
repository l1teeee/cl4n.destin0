import { timingSafeEqual } from "node:crypto";

import { env } from "@/infrastructure/config/env";
import { refreshConfiguredInstagramToken } from "@/infrastructure/instagram/instagram-connection-runtime";
import { drainMessageOutbox } from "@/infrastructure/messaging/drain-message-outbox";
import { retryConfiguredInboundImages } from "@/infrastructure/messaging/ingest-instagram-events";
import { log } from "@/infrastructure/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IMAGE_RETRY_BUDGET_MS = 15_000;
const COMPLETION_MARGIN_MS = 10_000;

function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const startedAt = Date.now();
  const deadline = startedAt + maxDuration * 1000 - COMPLETION_MARGIN_MS;
  if (env.MESSAGING_MODE === "instagram") {
    try {
      const result = await refreshConfiguredInstagramToken();
      log("info", "instagram_token_refresh", { result });
    } catch {
      log("error", "instagram_token_refresh_failed");
    }
  }
  await retryConfiguredInboundImages(20, startedAt + IMAGE_RETRY_BUDGET_MS);
  const summary = await drainMessageOutbox({
    limit: 50,
    timeBudgetMs: Math.max(0, deadline - Date.now()),
  });
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
