import type { ConsumptionSource, GuestSlot } from "@/domain/economy/consumption";

import type { PickerItem } from "../extras/extra-repository";

export interface ConsumptionLine {
  id: string;
  source: ConsumptionSource;
  itemName: string;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
  createdAt: Date;
  voidedAt: Date | null;
}

export interface EconomyGuest {
  reservationId: string;
  reservationNumber: number;
  slot: GuestSlot;
  fullName: string;
  instagram: string | null;
  stage: "ON_LIST" | "PAID";
  totalCents: number;
  settled: boolean;
  settledAt: Date | null;
  lines: ConsumptionLine[];
}

export interface EventEconomy {
  eventTotalCents: number;
  guests: EconomyGuest[];
}

export interface TabReference {
  eventId: string;
  reservationId: string;
  slot: GuestSlot;
}

export type AddConsumptionItem =
  | { source: "DRINK" | "EXTRA"; itemId: string }
  | { source: "CUSTOM"; customName: string; customPriceCents: number };

export type AddConsumptionCommand = TabReference &
  AddConsumptionItem & {
    quantity: number;
    adminId: string;
  };

export type AddConsumptionFailureCode = "GUEST_NOT_FOUND" | "ITEM_NOT_FOUND";

export type AddConsumptionInputFailureCode = "INVALID_QUANTITY" | "INVALID_PRICE" | "INVALID_NAME";

export type AddConsumptionResult =
  | { ok: true; line: ConsumptionLine }
  | { ok: false; code: AddConsumptionFailureCode | AddConsumptionInputFailureCode };

export interface VoidConsumptionCommand {
  eventId: string;
  consumptionId: string;
  adminId: string;
}

export type VoidConsumptionResult =
  { ok: true } | { ok: false; code: "NOT_FOUND" | "ALREADY_VOIDED" };

export type TabCommand = TabReference & { adminId: string };

// changed is false when the tab was already in the requested state.
export type TabResult = { ok: true; changed: boolean } | { ok: false; code: "GUEST_NOT_FOUND" };

export interface EconomyRepository {
  loadEventEconomy(eventId: string): Promise<EventEconomy>;
  addConsumption(
    command: AddConsumptionCommand,
  ): Promise<{ ok: true; line: ConsumptionLine } | { ok: false; code: AddConsumptionFailureCode }>;
  voidConsumption(command: VoidConsumptionCommand): Promise<VoidConsumptionResult>;
  settleTab(command: TabCommand): Promise<TabResult>;
  reopenTab(command: TabCommand): Promise<TabResult>;
  listPickerDrinks(): Promise<PickerItem[]>;
}
