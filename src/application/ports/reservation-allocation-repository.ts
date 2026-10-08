import type { ReservationErrorCode } from "@/domain/reservation/reservation-outcome";

export interface ReservationResponse {
  status: number;
  body: Record<string, unknown>;
  retryAfterSeconds?: number;
}

export type AllocationOutcome =
  | {
      code: "CONFIRMED";
      number: number;
      partySize: number;
      eventStartsAt: Date;
    }
  | {
      code: Extract<
        ReservationErrorCode,
        | "IDEMPOTENCY_KEY_REUSED"
        | "EVENT_NOT_FOUND"
        | "EVENT_NOT_OPEN"
        | "PARTY_SIZE_NOT_ALLOWED"
        | "DUPLICATE_RESERVATION"
        | "EVENT_FULL"
        | "TRY_AGAIN"
      >;
    };

export interface AllocationCommand {
  idempotencyKey: string;
  fingerprint: string;
  eventSlug: string;
  fullName: string;
  instagramHandle: string;
  phoneE164: string;
  email: string;
  emailNormalized: string;
  partySize: number;
  notes?: string;
  mapOutcome(outcome: AllocationOutcome): ReservationResponse;
}

export interface CompletedIdempotencyRecord {
  requestFingerprint: string;
  response: ReservationResponse;
}

export interface AllocationResult extends ReservationResponse {
  replayed: boolean;
  outcome?: AllocationOutcome;
}

export type CancelReservationOutcome = "CANCELLED" | "NOT_CANCELLABLE" | "NOT_FOUND";

export interface CancelReservationCommand {
  reservationId: string;
  actorAdminId: string;
}

export interface ReservationAllocationRepository {
  findCompletedIdempotencyRecord(key: string): Promise<CompletedIdempotencyRecord | null>;
  allocate(command: AllocationCommand): Promise<AllocationResult>;
  cancelReservation(command: CancelReservationCommand): Promise<CancelReservationOutcome>;
}
