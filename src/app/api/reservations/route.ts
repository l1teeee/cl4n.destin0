import * as Sentry from "@sentry/nextjs";

import { createBotVerifier } from "@/infrastructure/bot-protection/turnstile-verifier";
import { env } from "@/infrastructure/config/env";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
import { scheduleEmailDelivery } from "@/infrastructure/email/outbox/schedule-email-delivery";
import { log } from "@/infrastructure/observability/logger";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";

import { createReservationHandler } from "./reservation-handler";

export const dynamic = "force-dynamic";

const repository = new PostgresReservationAllocationRepository();

export const POST = createReservationHandler({
  repository,
  rateLimiter: { consume },
  botVerifier: createBotVerifier(),
  computeFingerprint: requestFingerprint,
  onReservationAccepted: scheduleEmailDelivery,
  observability: {
    log,
    ...(env.SENTRY_DSN
      ? {
          captureException(error: unknown) {
            Sentry.captureException(error);
          },
        }
      : {}),
  },
});

function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const HEAD = methodNotAllowed;
