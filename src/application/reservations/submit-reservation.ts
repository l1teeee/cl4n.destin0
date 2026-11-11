import { z } from "zod";

import type { BotVerifier } from "@/application/ports/bot-verifier";
import type {
  AllocationResult,
  ReservationAllocationRepository,
  ReservationResponse,
} from "@/application/ports/reservation-allocation-repository";
import { guestRequestSchema, INVALID_INSTAGRAM_MESSAGE } from "@/contracts/guest-request";
import { normalizeInstagram } from "@/domain/reservation/contact-normalization";

import {
  RESERVATION_INSTAGRAM_RATE_LIMIT,
  RESERVATION_IP_RATE_LIMIT,
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
  generateLinkCode(): string;
  computeFingerprint(input: {
    eventSlug: string;
    guests: { name: string; instagram: string }[];
    notes?: string;
    hasAllergies: boolean;
    allergies: string | null;
    acceptTerms: true;
  }): string;
}

export interface SubmitReservationInput {
  idempotencyKey: string | null;
  body: unknown;
  remoteIp: string | null;
  rateLimitSubject: string;
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

    const parsed = guestRequestSchema.safeParse(input.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".") || "request";
        (fieldErrors[field] ??= []).push(issue.message);
      }
      return validationFailure(fieldErrors);
    }

    const guests: { name: string; instagram: string }[] = [];
    for (const [index, guest] of parsed.data.guests.entries()) {
      const normalized = normalizeInstagram(guest.instagram);
      if (!normalized.ok) {
        return normalizationFailure(`guests.${index}.instagram`, INVALID_INSTAGRAM_MESSAGE);
      }
      guests.push({ name: guest.name, instagram: normalized.value });
    }
    const allergies = parsed.data.hasAllergies ? parsed.data.allergies! : null;

    const fingerprint = dependencies.computeFingerprint({
      eventSlug: parsed.data.eventSlug,
      guests,
      notes: parsed.data.notes,
      hasAllergies: parsed.data.hasAllergies,
      allergies,
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

    const ipLimit = await dependencies.rateLimiter.consume({
      ...RESERVATION_IP_RATE_LIMIT,
      subject: input.rateLimitSubject,
    });
    if (!ipLimit.allowed) {
      return {
        ...mapReservationOutcome({
          code: "RATE_LIMITED",
          retryAfterSeconds: ipLimit.retryAfterSeconds,
        }),
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

    const handles = new Set(guests.map((guest) => guest.instagram));
    const identityLimits = await Promise.all(
      [...handles].map((handle) =>
        dependencies.rateLimiter.consume({
          ...RESERVATION_INSTAGRAM_RATE_LIMIT,
          subject: handle,
        }),
      ),
    );
    const blockedIdentityLimits = identityLimits.filter((result) => !result.allowed);
    if (blockedIdentityLimits.length > 0) {
      const retryAfterSeconds = Math.max(
        ...blockedIdentityLimits.map((result) => result.retryAfterSeconds),
      );
      return {
        ...mapReservationOutcome({ code: "RATE_LIMITED", retryAfterSeconds }),
        replayed: false,
      };
    }

    const allocation: AllocationResult = await dependencies.repository.allocate({
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      eventSlug: parsed.data.eventSlug,
      guests,
      notes: parsed.data.notes,
      allergies,
      linkCode: dependencies.generateLinkCode(),
      mapOutcome: mapReservationOutcome,
    });

    return allocation;
  };
}
