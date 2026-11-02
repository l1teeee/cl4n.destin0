import { timingSafeEqual } from "node:crypto";

import {
  purgeExpiredPersonalData,
  purgeExpiredUnattributedPersonalData,
} from "@/application/privacy/purge-expired-personal-data";
import { env } from "@/infrastructure/config/env";
import { PostgresPersonalDataRetentionRepository } from "@/infrastructure/db/repositories/postgres-personal-data-retention-repository";
import { log } from "@/infrastructure/observability/logger";

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
  const repository = new PostgresPersonalDataRetentionRepository();
  const purgedEvents = await purgeExpiredPersonalData(
    {
      repository,
      onEventFailure: (eventId) => log("error", "personal_data_purge_failed", { eventId }),
    },
    { limit: 20 },
  );
  const { messages: purgedMessages, contacts: purgedContacts } =
    await purgeExpiredUnattributedPersonalData({ repository }, { timeBudgetMs: 40_000 });
  log("info", "personal_data_purged", {
    events: purgedEvents,
    messages: purgedMessages,
    contacts: purgedContacts,
  });
  return Response.json(
    { purgedEvents, purgedMessages, purgedContacts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
