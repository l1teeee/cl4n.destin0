import * as Sentry from "@sentry/nextjs";

import { createBotVerifier } from "@/infrastructure/bot-protection/turnstile-verifier";
import { env } from "@/infrastructure/config/env";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import { requestFingerprint } from "@/infrastructure/crypto/request-fingerprint";
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
