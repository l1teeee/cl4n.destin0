import { randomUUID } from "node:crypto";

import type { SubmitReservationDependencies } from "@/application/reservations/submit-reservation";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { mapReservationOutcome } from "@/application/reservations/reservation-response";
import { retryableDatabaseErrorCode } from "@/infrastructure/db/retryable-database-error";
import { getRateLimitSubject, getRawClientIp } from "@/infrastructure/http/client-ip";

interface HandlerObservability {
  log(
    level: "info" | "warn" | "error",
    message: string,
    fields: Record<string, string | number>,
  ): void;
  captureException?(error: unknown): void;
}

export interface ReservationHandlerDependencies extends SubmitReservationDependencies {
  observability: HandlerObservability;
  onReservationAccepted?(): void;
}

const MAXIMUM_BODY_BYTES = 16 * 1024;

type BodyReadResult = { ok: true; text: string } | { ok: false };

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readBody(request: Request): Promise<BodyReadResult> {
  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;

    byteLength += chunk.value.byteLength;
    if (byteLength > MAXIMUM_BODY_BYTES) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(bytes) };
}

function outcomeCode(body: Record<string, unknown>): string {
  if (body.status === "CONFIRMED") {
    return "CONFIRMED";
  }

  const error = body.error;
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }

  return "UNKNOWN";
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  options: { replayed?: boolean; retryAfterSeconds?: number } = {},
): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });

  if (options.replayed) {
    headers.set("Idempotent-Replayed", "true");
  }
  if (status === 429 || status === 503) {
    headers.set("Retry-After", String(options.retryAfterSeconds ?? 1));
  }

  return new Response(JSON.stringify(body), { status, headers });
}

export function createReservationHandler(dependencies: ReservationHandlerDependencies) {
  const submitReservation = createSubmitReservation(dependencies);

  return async function POST(request: Request): Promise<Response> {
    const startedAt = performance.now();
    const requestId = request.headers.get("x-vercel-id") ?? randomUUID();

    try {
      const declaredLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BODY_BYTES) {
        const oversized = mapReservationOutcome({ code: "PAYLOAD_TOO_LARGE" });
        dependencies.observability.log("info", "reservation_submission", {
          requestId,
          route: "/api/reservations",
          outcome: "PAYLOAD_TOO_LARGE",
          durationMs: Math.round(performance.now() - startedAt),
        });
        return jsonResponse(oversized.status, oversized.body);
      }

      if (!isJsonContentType(request.headers.get("content-type"))) {
        const unsupported = mapReservationOutcome({ code: "UNSUPPORTED_MEDIA_TYPE" });
        dependencies.observability.log("info", "reservation_submission", {
          requestId,
          route: "/api/reservations",
          outcome: "UNSUPPORTED_MEDIA_TYPE",
          durationMs: Math.round(performance.now() - startedAt),
        });
        return jsonResponse(unsupported.status, unsupported.body);
      }

      const bodyRead = await readBody(request);
      if (!bodyRead.ok) {
        const oversized = mapReservationOutcome({ code: "PAYLOAD_TOO_LARGE" });
        dependencies.observability.log("info", "reservation_submission", {
          requestId,
          route: "/api/reservations",
          outcome: "PAYLOAD_TOO_LARGE",
          durationMs: Math.round(performance.now() - startedAt),
        });
        return jsonResponse(oversized.status, oversized.body);
      }

      let body: unknown;
      try {
        body = JSON.parse(bodyRead.text);
      } catch {
        const invalidJson = mapReservationOutcome({
          code: "VALIDATION_FAILED",
          fieldErrors: { request: ["El cuerpo debe contener JSON válido."] },
        });
        dependencies.observability.log("info", "reservation_submission", {
          requestId,
          route: "/api/reservations",
          outcome: "VALIDATION_FAILED",
          durationMs: Math.round(performance.now() - startedAt),
        });
        return jsonResponse(invalidJson.status, invalidJson.body);
      }

      const remoteIp = getRawClientIp(request.headers);
      const result = await submitReservation({
        idempotencyKey: request.headers.get("Idempotency-Key"),
        body,
        remoteIp,
        rateLimitSubject: getRateLimitSubject(remoteIp),
      });
      const outcome = outcomeCode(result.body);
      dependencies.observability.log("info", "reservation_submission", {
        requestId,
        route: "/api/reservations",
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
      });
      if (result.acceptedReservation) {
        try {
          dependencies.onReservationAccepted?.();
        } catch (error) {
          dependencies.observability.log("error", "reservation_confirmation_schedule_failed", {
            requestId,
          });
          dependencies.observability.captureException?.(error);
        }
      }

      return jsonResponse(result.status, result.body, {
        replayed: result.replayed,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    } catch (error) {
      const retryableCode = retryableDatabaseErrorCode(error);
      if (retryableCode) {
        dependencies.observability.log("warn", "reservation_submission_retryable", {
          requestId,
          route: "/api/reservations",
          outcome: "TRY_AGAIN",
          code: retryableCode,
          durationMs: Math.round(performance.now() - startedAt),
        });
        const retryable = mapReservationOutcome({ code: "TRY_AGAIN", retryAfterSeconds: 1 });
        return jsonResponse(retryable.status, retryable.body, {
          retryAfterSeconds: retryable.retryAfterSeconds,
        });
      }

      dependencies.observability.log("error", "reservation_submission_failed", {
        requestId,
        route: "/api/reservations",
        outcome: "INTERNAL_ERROR",
        durationMs: Math.round(performance.now() - startedAt),
      });
      dependencies.observability.captureException?.(error);
      const internalError = mapReservationOutcome({ code: "INTERNAL_ERROR", requestId });
      return jsonResponse(internalError.status, internalError.body);
    }
  };
}
