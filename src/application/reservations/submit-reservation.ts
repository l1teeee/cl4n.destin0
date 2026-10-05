import { z } from "zod";

import type { BotVerifier } from "@/application/ports/bot-verifier";
import type {
  AllocationResult,
  ReservationAllocationRepository,
  ReservationResponse,
} from "@/application/ports/reservation-allocation-repository";
import { reservationRequestSchema } from "@/contracts/reservation-request";
import {
  normalizeEmail,
  normalizeInstagram,
  normalizePhone,
} from "@/domain/reservation/contact-normalization";

import {
  RESERVATION_EMAIL_RATE_LIMIT,
  RESERVATION_IP_RATE_LIMIT,
  RESERVATION_PHONE_RATE_LIMIT,
} from "./reservation-rate-limits";
import { mapReservationOutcome } from "./reservation-response";

export interface ReservationRateLimiter {
  consume(input: {
    scope: string;
    subject: string;
    limit: number;
    windowSeconds: number;
  }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export interface SubmitReservationDependencies {
  repository: ReservationAllocationRepository;
  rateLimiter: ReservationRateLimiter;
  botVerifier: BotVerifier;
  computeFingerprint(input: {
    eventSlug: string;
    fullName: string;
    instagram: string;
    phone: string;
    email: string;
    partySize: number;
    notes?: string;
    acceptTerms: true;
  }): string;
}

export interface SubmitReservationInput {
  idempotencyKey: string | null;
  body: unknown;
  remoteIp: string;
}

export interface SubmitReservationResult extends ReservationResponse {
  replayed: boolean;
}

const idempotencyKeySchema = z.uuid();

function validationFailure(fieldErrors: Record<string, string[]>): SubmitReservationResult {
  return {
    ...mapReservationOutcome({ code: "VALIDATION_FAILED", fieldErrors }),
    replayed: false,
  };
}

function normalizationFailure(field: string, message: string): SubmitReservationResult {
  return validationFailure({ [field]: [message] });
}

export function createSubmitReservation(dependencies: SubmitReservationDependencies) {
  return async function submitReservation(
    input: SubmitReservationInput,
  ): Promise<SubmitReservationResult> {
    if (!input.idempotencyKey || !idempotencyKeySchema.safeParse(input.idempotencyKey).success) {
      return {
        ...mapReservationOutcome({ code: "IDEMPOTENCY_KEY_REQUIRED" }),
        replayed: false,
      };
    }

    const parsed = reservationRequestSchema.safeParse(input.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "request");
        (fieldErrors[field] ??= []).push(issue.message);
      }
      return validationFailure(fieldErrors);
    }

    const email = normalizeEmail(parsed.data.email);
    const phone = normalizePhone(parsed.data.phone);
    const instagram = normalizeInstagram(parsed.data.instagram);

    if (!email.ok) {
      return normalizationFailure("email", "Ingresa un email válido.");
    }
    if (!phone.ok) {
      return normalizationFailure("phone", "Ingresa un teléfono válido.");
    }
    if (!instagram.ok) {
      return normalizationFailure("instagram", "Ingresa un usuario de Instagram válido.");
    }

    const fingerprint = dependencies.computeFingerprint({
      eventSlug: parsed.data.eventSlug,
      fullName: parsed.data.fullName,
      instagram: instagram.value,
      phone: phone.value,
      email: email.value,
      partySize: parsed.data.partySize,
      notes: parsed.data.notes,
      acceptTerms: true,
    });
    const completed = await dependencies.repository.findCompletedIdempotencyRecord(
      input.idempotencyKey,
    );

    if (completed) {
      if (completed.requestFingerprint !== fingerprint) {
        return {
          ...mapReservationOutcome({ code: "IDEMPOTENCY_KEY_REUSED" }),
          replayed: false,
        };
      }

      return { ...completed.response, replayed: true };
    }

    const limits = await Promise.all([
      dependencies.rateLimiter.consume({
        ...RESERVATION_IP_RATE_LIMIT,
        subject: input.remoteIp,
      }),
      dependencies.rateLimiter.consume({
        ...RESERVATION_EMAIL_RATE_LIMIT,
        subject: email.value,
      }),
      dependencies.rateLimiter.consume({
        ...RESERVATION_PHONE_RATE_LIMIT,
        subject: phone.value,
      }),
    ]);
    const blocked = limits.filter((result) => !result.allowed);
    if (blocked.length > 0) {
      const retryAfterSeconds = Math.max(...blocked.map((result) => result.retryAfterSeconds));
      return {
        ...mapReservationOutcome({ code: "RATE_LIMITED", retryAfterSeconds }),
        replayed: false,
      };
    }

    const botResult = await dependencies.botVerifier.verify({
      token: parsed.data.turnstileToken,
      remoteIp: input.remoteIp,
      idempotencyKey: input.idempotencyKey,
    });
    if (!botResult.ok) {
      return {
        ...mapReservationOutcome({
          code: "BOT_CHECK_FAILED",
          ...(botResult.reason === "TOKEN_EXPIRED_OR_SPENT" ? { reason: botResult.reason } : {}),
        }),
        replayed: false,
      };
    }

    const allocation: AllocationResult = await dependencies.repository.allocate({
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      eventSlug: parsed.data.eventSlug,
      fullName: parsed.data.fullName,
      instagramHandle: instagram.value,
      phoneE164: phone.value,
      email: parsed.data.email.trim(),
      emailNormalized: email.value,
      partySize: parsed.data.partySize,
      notes: parsed.data.notes,
      mapOutcome: mapReservationOutcome,
    });

    return allocation;
  };
}
