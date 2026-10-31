export type GuestAdminErrorCode =
  | "INVALID_STAGE"
  | "WAITLIST_CHANGED"
  | "NO_SEAT"
  | "NO_SPACE"
  | "DUPLICATE_HANDLE"
  | "EVENT_NOT_EDITABLE"
  | "AT_EDGE";

export interface GuestFields {
  partySize: 1 | 2;
  guest1Name: string;
  guest1Instagram: string;
  guest2Name: string | null;
  guest2Instagram: string | null;
  hasAllergies: boolean;
  allergies: string | null;
  notes: string | null;
}

export interface PromotedGuest {
  entryId: string;
  reservationId: string;
  guests: string[];
}

export interface GuestMutationSuccess {
  ok: true;
  eventId: string;
  guests: string[];
  messageIds: string[];
  promoted: PromotedGuest[];
}

export interface GuestMutationFailure {
  ok: false;
  code: GuestAdminErrorCode;
  field?: "guest1Instagram" | "guest2Instagram";
}

export type GuestMutationResult<T extends object = Record<string, never>> =
  (GuestMutationSuccess & T) | GuestMutationFailure;

export interface ReservationCommand {
  reservationId: string;
  actorAdminId: string;
}

export interface VerifyPaymentCommand extends ReservationCommand {
  paymentNote: string | null;
}

export interface ReleaseReservationCommand extends ReservationCommand {
  sendMessage: boolean;
  expectedPromotedEntryIds: string[];
}

export interface MarkRefundedCommand extends ReservationCommand {
  sendMessage: boolean;
}

export interface UpdateReservationCommand extends ReservationCommand {
  fields: GuestFields;
}

export interface WaitlistEntryCommand {
  entryId: string;
  actorAdminId: string;
}

export interface UpdateWaitlistEntryCommand extends WaitlistEntryCommand {
  fields: GuestFields;
}

export interface MoveWaitlistEntryCommand extends WaitlistEntryCommand {
  direction: "UP" | "DOWN";
}

export interface RemoveWaitlistEntryCommand extends WaitlistEntryCommand {
  sendMessage: boolean;
}

export interface AddRequestCommand {
  eventId: string;
  actorAdminId: string;
  fields: GuestFields;
  linkCode: string;
  idempotencyKey: string;
}

export interface GuestAdminRepository {
  accept(command: ReservationCommand): Promise<GuestMutationResult>;
  verifyPayment(command: VerifyPaymentCommand): Promise<GuestMutationResult>;
  reject(command: ReleaseReservationCommand): Promise<GuestMutationResult>;
  cancel(
    command: ReleaseReservationCommand,
  ): Promise<GuestMutationResult<{ refundPending: boolean }>>;
  markRefunded(command: MarkRefundedCommand): Promise<GuestMutationResult>;
  update(command: UpdateReservationCommand): Promise<GuestMutationResult>;
  updateEntry(command: UpdateWaitlistEntryCommand): Promise<GuestMutationResult>;
  moveEntry(command: MoveWaitlistEntryCommand): Promise<GuestMutationResult>;
  promoteEntry(command: WaitlistEntryCommand): Promise<GuestMutationResult>;
  removeEntry(command: RemoveWaitlistEntryCommand): Promise<GuestMutationResult>;
  addRequest(
    command: AddRequestCommand,
  ): Promise<GuestMutationResult<{ placement: "LIST" | "QUEUE"; position: number | null }>>;
}
