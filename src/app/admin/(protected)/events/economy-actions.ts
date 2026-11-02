"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import type {
  AddConsumptionCommand,
  AddConsumptionResult,
  TabResult,
  VoidConsumptionResult,
} from "@/application/economy/economy-repository";
import {
  addConsumption,
  reopenTab,
  settleTab,
  voidConsumption,
} from "@/application/economy/economy-use-cases";
import {
  consumptionFormSchema,
  economyConsumptionIdSchema,
  economyEventIdSchema,
  economyReservationIdSchema,
  guestSlotSchema,
  readConsumptionFormData,
} from "@/contracts/admin-economy";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEconomyRepository } from "@/infrastructure/db/repositories/postgres-economy-repository";

const UNAUTHORIZED: AdminActionState = {
  ok: false,
  message: "Tu sesión no es válida. Inicia sesión nuevamente.",
};

const GUEST_NOT_FOUND = "El invitado ya no está en la lista de la experiencia.";

const tabReferenceSchema = z.object({
  eventId: economyEventIdSchema,
  reservationId: economyReservationIdSchema,
  slot: guestSlotSchema,
});

const addFailureMessages: Record<Extract<AddConsumptionResult, { ok: false }>["code"], string> = {
  GUEST_NOT_FOUND: GUEST_NOT_FOUND,
  ITEM_NOT_FOUND: "El producto ya no está disponible.",
  INVALID_QUANTITY: "La cantidad no es válida.",
  INVALID_PRICE: "El precio no es válido.",
  INVALID_NAME: "El nombre no es válido.",
};

const voidFailureMessages: Record<Extract<VoidConsumptionResult, { ok: false }>["code"], string> = {
  NOT_FOUND: "No se encontró el consumo.",
  ALREADY_VOIDED: "Ese consumo ya estaba anulado.",
};

const tabFailureMessages: Record<Extract<TabResult, { ok: false }>["code"], string> = {
  GUEST_NOT_FOUND: GUEST_NOT_FOUND,
};

function revalidateEconomyPaths(eventId: string): void {
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/audit");
}

export async function addConsumptionAction(
  eventId: string,
  reservationId: string,
  slot: number,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return UNAUTHORIZED;

  const reference = tabReferenceSchema.safeParse({ eventId, reservationId, slot });
  if (!reference.success) return { ok: false, message: reference.error.issues[0]!.message };
  const parsed = consumptionFormSchema.safeParse(readConsumptionFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: fieldErrorsFromZod(parsed.error),
    };
  }

  const adminId = authorization.session.admin.id;
  const command: AddConsumptionCommand =
    parsed.data.source === "CUSTOM"
      ? {
          ...reference.data,
          source: "CUSTOM",
          customName: parsed.data.customName,
          customPriceCents: parsed.data.customPriceCents,
          quantity: parsed.data.quantity,
          adminId,
        }
      : {
          ...reference.data,
          source: parsed.data.source,
          itemId: parsed.data.itemId,
          quantity: parsed.data.quantity,
          adminId,
        };
  const result = await addConsumption(postgresEconomyRepository, command);
  if (!result.ok) return { ok: false, message: addFailureMessages[result.code] };

  revalidateEconomyPaths(reference.data.eventId);
  return { ok: true, message: "Consumo agregado." };
}

export async function voidConsumptionAction(
  eventId: string,
  consumptionId: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return UNAUTHORIZED;

  const parsedEventId = economyEventIdSchema.safeParse(eventId);
  if (!parsedEventId.success) return { ok: false, message: parsedEventId.error.issues[0]!.message };
  const parsedConsumptionId = economyConsumptionIdSchema.safeParse(consumptionId);
  if (!parsedConsumptionId.success) {
    return { ok: false, message: parsedConsumptionId.error.issues[0]!.message };
  }

  const result = await voidConsumption(postgresEconomyRepository, {
    eventId: parsedEventId.data,
    consumptionId: parsedConsumptionId.data,
    adminId: authorization.session.admin.id,
  });
  if (!result.ok) return { ok: false, message: voidFailureMessages[result.code] };

  revalidateEconomyPaths(parsedEventId.data);
  return { ok: true, message: "Consumo anulado." };
}

export async function settleTabAction(
  eventId: string,
  reservationId: string,
  slot: number,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return UNAUTHORIZED;

  const reference = tabReferenceSchema.safeParse({ eventId, reservationId, slot });
  if (!reference.success) return { ok: false, message: reference.error.issues[0]!.message };

  const result = await settleTab(postgresEconomyRepository, {
    ...reference.data,
    adminId: authorization.session.admin.id,
  });
  if (!result.ok) return { ok: false, message: tabFailureMessages[result.code] };

  revalidateEconomyPaths(reference.data.eventId);
  return { ok: true, message: "Cuenta marcada como pagada." };
}

export async function reopenTabAction(
  eventId: string,
  reservationId: string,
  slot: number,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return UNAUTHORIZED;

  const reference = tabReferenceSchema.safeParse({ eventId, reservationId, slot });
  if (!reference.success) return { ok: false, message: reference.error.issues[0]!.message };

  const result = await reopenTab(postgresEconomyRepository, {
    ...reference.data,
    adminId: authorization.session.admin.id,
  });
  if (!result.ok) return { ok: false, message: tabFailureMessages[result.code] };

  revalidateEconomyPaths(reference.data.eventId);
  return { ok: true, message: "Cuenta reabierta." };
}
