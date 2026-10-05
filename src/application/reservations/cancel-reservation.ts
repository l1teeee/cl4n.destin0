import type {
  CancelReservationCommand,
  CancelReservationOutcome,
  ReservationAllocationRepository,
} from "@/application/ports/reservation-allocation-repository";

export function createCancelReservation(repository: ReservationAllocationRepository) {
  return function cancelReservation(
    command: CancelReservationCommand,
  ): Promise<CancelReservationOutcome> {
    return repository.cancelReservation(command);
  };
}
