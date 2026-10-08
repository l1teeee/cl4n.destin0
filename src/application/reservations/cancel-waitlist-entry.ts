import type {
  CancelWaitlistEntryCommand,
  CancelWaitlistEntryOutcome,
  ReservationAllocationRepository,
} from "@/application/ports/reservation-allocation-repository";

export function createCancelWaitlistEntry(repository: ReservationAllocationRepository) {
  return function cancelWaitlistEntry(
    command: CancelWaitlistEntryCommand,
  ): Promise<CancelWaitlistEntryOutcome> {
    return repository.cancelWaitlistEntry(command);
  };
}
