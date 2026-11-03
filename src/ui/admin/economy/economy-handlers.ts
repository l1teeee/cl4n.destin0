import type { AdminActionState } from "@/app/admin/(protected)/events/actions";

export type AddConsumptionHandler = (
  eventId: string,
  reservationId: string,
  slot: number,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export type VoidConsumptionHandler = (
  eventId: string,
  consumptionId: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export type TabHandler = (
  eventId: string,
  reservationId: string,
  slot: number,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

// The page hands in the server actions so the economy components never import server-only modules.
export interface EconomyHandlers {
  add: AddConsumptionHandler;
  voidLine: VoidConsumptionHandler;
  settle: TabHandler;
  reopen: TabHandler;
  sendTab: TabHandler;
}

export const IDLE_ACTION_STATE: AdminActionState = { ok: false, message: "" };

export const UNEXPECTED_ERROR_STATE: AdminActionState = {
  ok: false,
  message: "No se pudo completar la acción. Intenta de nuevo.",
};
