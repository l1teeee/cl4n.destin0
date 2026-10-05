import { randomUUID } from "node:crypto";

import type { SubmitReservationDependencies } from "@/application/reservations/submit-reservation";
import { createSubmitReservation } from "@/application/reservations/submit-reservation";
import { mapReservationOutcome } from "@/application/reservations/reservation-response";
import { getClientIp } from "@/infrastructure/http/client-ip";

interface HandlerObservability {
  log(level: "info" | "error", message: string, fields: Record<string, string | number>): void;
  captureException?(error: unknown): void;
}

export interface ReservationHandlerDependencies extends SubmitReservationDependencies {
  observability: HandlerObservability;
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
      let body: unknown;
      try {
        body = await request.json();
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

      const result = await submitReservation({
        idempotencyKey: request.headers.get("Idempotency-Key"),
        body,
        remoteIp: getClientIp(request.headers),
      });
      const outcome = outcomeCode(result.body);
      dependencies.observability.log("info", "reservation_submission", {
        requestId,
        route: "/api/reservations",
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return jsonResponse(result.status, result.body, {
        replayed: result.replayed,
        retryAfterSeconds: result.retryAfterSeconds,
      });
    } catch (error) {
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
