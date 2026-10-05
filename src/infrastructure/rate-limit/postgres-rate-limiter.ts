import { pool } from "../db/client";
import { env } from "../config/env";
import { keyedHash } from "../crypto/keyed-hash";
import { log } from "../observability/logger";

export interface RateLimitDefinition {
  scope: string;
  limit: number;
  windowSeconds: number;
}

export const RESERVATION_IP_RATE_LIMIT = {
  scope: "reservation:ip",
  limit: 120,
  windowSeconds: 60,
} as const satisfies RateLimitDefinition;

export const RESERVATION_EMAIL_RATE_LIMIT = {
  scope: "reservation:email",
  limit: 5,
  windowSeconds: 600,
} as const satisfies RateLimitDefinition;

export const RESERVATION_PHONE_RATE_LIMIT = {
  scope: "reservation:phone",
  limit: 5,
  windowSeconds: 600,
} as const satisfies RateLimitDefinition;

export const ADMIN_LOGIN_IP_RATE_LIMIT = {
  scope: "admin-login:ip",
  limit: 20,
  windowSeconds: 900,
} as const satisfies RateLimitDefinition;

export const ADMIN_LOGIN_EMAIL_RATE_LIMIT = {
  scope: "admin-login:email",
  limit: 5,
  windowSeconds: 900,
} as const satisfies RateLimitDefinition;

export const RATE_LIMITS = {
  reservationIp: RESERVATION_IP_RATE_LIMIT,
  reservationEmail: RESERVATION_EMAIL_RATE_LIMIT,
  reservationPhone: RESERVATION_PHONE_RATE_LIMIT,
  adminLoginIp: ADMIN_LOGIN_IP_RATE_LIMIT,
  adminLoginEmail: ADMIN_LOGIN_EMAIL_RATE_LIMIT,
} as const;

export interface ConsumeRateLimitInput {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface CounterRow {
  hits: number;
  retry_after_seconds: number;
}

async function cleanupExpiredWindows(): Promise<void> {
  try {
    await pool.query(
      "DELETE FROM rate_limit_counters WHERE window_start < now() - INTERVAL '1 day'",
    );
  } catch (error) {
    log("warn", "rate_limit_cleanup_failed", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

export async function consume(input: ConsumeRateLimitInput): Promise<RateLimitResult> {
  if (env.RATE_LIMIT_MODE === "disabled") {
    return { allowed: true, remaining: input.limit, retryAfterSeconds: 0 };
  }

  const bucketKey = `${input.scope}:${keyedHash(input.subject)}`;
  const result = await pool.query<CounterRow>(
    `WITH current_window AS (
       SELECT date_bin(
         make_interval(secs => $2),
         now(),
         TIMESTAMPTZ '1970-01-01 00:00:00+00'
       ) AS window_start
     )
     INSERT INTO rate_limit_counters (bucket_key, window_start, hits)
     SELECT $1, window_start, 1
       FROM current_window
     ON CONFLICT (bucket_key, window_start)
     DO UPDATE SET hits = rate_limit_counters.hits + 1
     RETURNING
       hits,
       GREATEST(
         0,
         CEIL(EXTRACT(EPOCH FROM (
           window_start + make_interval(secs => $2) - now()
         )))
       )::integer AS retry_after_seconds`,
    [bucketKey, input.windowSeconds],
  );
  const counter = result.rows[0]!;
  const allowed = counter.hits <= input.limit;

  if (Math.random() < 0.01) {
    await cleanupExpiredWindows();
  }

  return {
    allowed,
    remaining: Math.max(0, input.limit - counter.hits),
    retryAfterSeconds: allowed ? 0 : counter.retry_after_seconds,
  };
}
