import { timingSafeEqual } from "node:crypto";

import { env } from "@/infrastructure/config/env";
import { drainMessageOutbox } from "@/infrastructure/messaging/drain-message-outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const summary = await drainMessageOutbox({ limit: 50, timeBudgetMs: 60_000 });
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
