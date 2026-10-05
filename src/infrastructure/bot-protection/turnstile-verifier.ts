import type {
  BotVerificationRequest,
  BotVerificationResult,
  BotVerifier,
} from "@/application/ports/bot-verifier";

import { env } from "../config/env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  cdata?: string;
  "error-codes"?: string[];
  metadata?: {
    result_with_testing_key?: boolean;
  };
}

export interface TurnstileVerifierOptions {
  secret: string;
  allowedHostnames: readonly string[];
  acceptTestingKeyResults: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class TurnstileVerifier implements BotVerifier {
  private readonly acceptTestingKeyResults: boolean;
  private readonly allowedHostnames: ReadonlySet<string>;
  private readonly fetch: typeof fetch;
  private readonly secret: string;
  private readonly timeoutMs: number;

  constructor(options: TurnstileVerifierOptions) {
    this.secret = options.secret;
    this.acceptTestingKeyResults = options.acceptTestingKeyResults;
    this.allowedHostnames = new Set(options.allowedHostnames);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async verify(request: BotVerificationRequest): Promise<BotVerificationResult> {
    const body = new URLSearchParams({
      secret: this.secret,
      response: request.token,
      idempotency_key: request.idempotencyKey,
    });

    if (request.remoteIp !== "local") {
      body.set("remoteip", request.remoteIp);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        return { ok: false, reason: "UNAVAILABLE" };
      }

      const result = (await response.json()) as TurnstileResponse;

      if (!result.success) {
        const expired = result["error-codes"]?.includes("timeout-or-duplicate") ?? false;
        return { ok: false, reason: expired ? "TOKEN_EXPIRED_OR_SPENT" : "INVALID" };
      }

      if (result.metadata?.result_with_testing_key === true) {
        return this.acceptTestingKeyResults ? { ok: true } : { ok: false, reason: "INVALID" };
      }

      const matchesRequest =
        result.action === "reserve" &&
        result.hostname !== undefined &&
        this.allowedHostnames.has(result.hostname) &&
        result.cdata === request.idempotencyKey;

      return matchesRequest ? { ok: true } : { ok: false, reason: "MISMATCH" };
    } catch {
      return { ok: false, reason: "UNAVAILABLE" };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class DisabledBotVerifier implements BotVerifier {
  async verify(): Promise<BotVerificationResult> {
    return { ok: true };
  }
}

export function createBotVerifier(
  fetchImplementation: typeof fetch = globalThis.fetch,
): BotVerifier {
  if (env.BOT_PROTECTION_MODE === "disabled") {
    return new DisabledBotVerifier();
  }

  return new TurnstileVerifier({
    secret: env.TURNSTILE_SECRET_KEY!,
    allowedHostnames: env.TURNSTILE_ALLOWED_HOSTNAMES,
    acceptTestingKeyResults: env.APP_ENV === "local" || env.APP_ENV === "test",
    fetch: fetchImplementation,
  });
}
