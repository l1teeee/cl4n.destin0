import type { AdminActionState } from "@/app/admin/(protected)/events/actions";

export type GuestAction = (
  id: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

// The page hands in the server actions so the guest components never import server-only modules.
export interface GuestActionHandlers {
  accept: GuestAction;
  verifyPayment: GuestAction;
  reject: GuestAction;
  cancel: GuestAction;
  markRefunded: GuestAction;
  move: GuestAction;
  promote: GuestAction;
  remove: GuestAction;
  updateRequest: GuestAction;
  updateEntry: GuestAction;
  add: GuestAction;
  retryMessage: GuestAction;
  markMessageSent: GuestAction;
  discardMessage: GuestAction;
}
