import {
  isValidItemName,
  isValidQuantity,
  isValidUnitPriceCents,
} from "@/domain/economy/consumption";

import type { PickerItem } from "../extras/extra-repository";
import type {
  AddConsumptionCommand,
  AddConsumptionResult,
  EconomyRepository,
  EventEconomy,
  TabCommand,
  TabResult,
  VoidConsumptionCommand,
  VoidConsumptionResult,
} from "./economy-repository";

export function loadEventEconomy(
  repository: EconomyRepository,
  eventId: string,
): Promise<EventEconomy> {
  return repository.loadEventEconomy(eventId);
}

export function listActiveDrinksForEconomy(repository: EconomyRepository): Promise<PickerItem[]> {
  return repository.listPickerDrinks();
}

export async function addConsumption(
  repository: EconomyRepository,
  command: AddConsumptionCommand,
): Promise<AddConsumptionResult> {
  if (!isValidQuantity(command.quantity)) return { ok: false, code: "INVALID_QUANTITY" };

  if (command.source !== "CUSTOM") return repository.addConsumption(command);

  const customName = command.customName.trim();
  if (!isValidItemName(customName)) return { ok: false, code: "INVALID_NAME" };
  if (!isValidUnitPriceCents(command.customPriceCents)) return { ok: false, code: "INVALID_PRICE" };
  return repository.addConsumption({ ...command, customName });
}

export function voidConsumption(
  repository: EconomyRepository,
  command: VoidConsumptionCommand,
): Promise<VoidConsumptionResult> {
  return repository.voidConsumption(command);
}

export function settleTab(repository: EconomyRepository, command: TabCommand): Promise<TabResult> {
  return repository.settleTab(command);
}

export function reopenTab(repository: EconomyRepository, command: TabCommand): Promise<TabResult> {
  return repository.reopenTab(command);
}
