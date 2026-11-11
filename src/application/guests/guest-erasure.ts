export type GuestErasureSubject = { reservationId: string } | { waitlistEntryId: string };

export type GuestErasureResult =
  "ERASED" | "NOT_FOUND" | "ACTIVE" | "ALREADY_ERASED" | "LIVE_LEASE";

export interface GuestErasureRepository {
  erase(subject: GuestErasureSubject, adminId: string): Promise<GuestErasureResult>;
}

export function eraseGuestData(
  repository: GuestErasureRepository,
  subject: GuestErasureSubject,
  adminId: string,
): Promise<GuestErasureResult> {
  return repository.erase(subject, adminId);
}
