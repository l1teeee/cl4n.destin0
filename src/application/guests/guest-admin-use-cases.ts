import type {
  AddRequestCommand,
  GuestAdminRepository,
  MarkRefundedCommand,
  MoveWaitlistEntryCommand,
  ReleaseReservationCommand,
  ReservationCommand,
  UpdateReservationCommand,
  UpdateWaitlistEntryCommand,
  VerifyPaymentCommand,
  WaitlistEntryCommand,
  RemoveWaitlistEntryCommand,
} from "./guest-admin-repository";

export function acceptRequest(repository: GuestAdminRepository, command: ReservationCommand) {
  return repository.accept(command);
}

export function verifyPayment(repository: GuestAdminRepository, command: VerifyPaymentCommand) {
  return repository.verifyPayment(command);
}

export function rejectRequest(
  repository: GuestAdminRepository,
  command: ReleaseReservationCommand,
) {
  return repository.reject(command);
}

export function cancelRequest(
  repository: GuestAdminRepository,
  command: ReleaseReservationCommand,
) {
  return repository.cancel(command);
}

export function markRefunded(repository: GuestAdminRepository, command: MarkRefundedCommand) {
  return repository.markRefunded(command);
}

export function updateRequest(repository: GuestAdminRepository, command: UpdateReservationCommand) {
  return repository.update(command);
}

export function updateEntry(repository: GuestAdminRepository, command: UpdateWaitlistEntryCommand) {
  return repository.updateEntry(command);
}

export function moveEntry(repository: GuestAdminRepository, command: MoveWaitlistEntryCommand) {
  return repository.moveEntry(command);
}

export function promoteEntry(repository: GuestAdminRepository, command: WaitlistEntryCommand) {
  return repository.promoteEntry(command);
}

export function removeEntry(repository: GuestAdminRepository, command: RemoveWaitlistEntryCommand) {
  return repository.removeEntry(command);
}

export function addRequest(repository: GuestAdminRepository, command: AddRequestCommand) {
  return repository.addRequest(command);
}
