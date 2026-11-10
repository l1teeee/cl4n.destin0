import type { ReservationErrorCode } from "@/domain/reservation/reservation-outcome";

export interface ReservationResponse {
  status: number;
  body: Record<string, unknown>;
  retryAfterSeconds?: number;
}

export type AllocationOutcome =
  | {
      code: "RECEIVED";
      number: number;
      partySize: 1 | 2;
      eventStartsAt: Date;
      linkCode: string;
    }
  | {
      code: "WAITLISTED";
      position: number;
      partySize: 1 | 2;
      eventStartsAt: Date;
      linkCode: string;
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
  guest2FullName: string | null;
  guest2InstagramHandle: string | null;
  partySize: 1 | 2;
  notes?: string;
  allergies: string | null;
  linkCode: string;
  mapOutcome(outcome: AllocationOutcome): ReservationResponse;
}

export interface CompletedIdempotencyRecord {
  requestFingerprint: string;
  response: ReservationResponse;
}

export interface ImportAllocationCommand extends Omit<AllocationCommand, "eventSlug"> {
  eventId: string;
  adminId: string;
  importId: string;
  rowNumber: number;
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

export type CancelWaitlistEntryOutcome = CancelReservationOutcome;

export interface CancelWaitlistEntryCommand {
  waitlistEntryId: string;
  actorAdminId: string;
}

export interface ReservationAllocationRepository {
  findCompletedIdempotencyRecord(key: string): Promise<CompletedIdempotencyRecord | null>;
  allocate(command: AllocationCommand): Promise<AllocationResult>;
  allocateImported(command: ImportAllocationCommand): Promise<AllocationResult>;
  cancelReservation(command: CancelReservationCommand): Promise<CancelReservationOutcome>;
  cancelWaitlistEntry(command: CancelWaitlistEntryCommand): Promise<CancelWaitlistEntryOutcome>;
}
