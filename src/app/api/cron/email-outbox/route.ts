import { timingSafeEqual } from "node:crypto";

import { env } from "@/infrastructure/config/env";
import { postgresEmailOutboxRepository } from "@/infrastructure/email/outbox/postgres-email-outbox-repository";
import { drainEmailOutbox } from "@/infrastructure/email/outbox/drain-email-outbox";

export const dynamic = "force-dynamic";
// The drain budget is 60 s, so the function must be allowed to run that long.
export const maxDuration = 60;

const CRON_DRAIN_LIMIT = 50;
const CRON_DRAIN_TIME_BUDGET_MS = 60_000;
const SENT_RETENTION_DAYS = 90;

function hasValidBearerToken(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request): Promise<Response> {
  if (!hasValidBearerToken(request)) {
    return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const summary = await drainEmailOutbox({
    limit: CRON_DRAIN_LIMIT,
    timeBudgetMs: CRON_DRAIN_TIME_BUDGET_MS,
  });
  await postgresEmailOutboxRepository.deleteSentOlderThan(SENT_RETENTION_DAYS);

  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
