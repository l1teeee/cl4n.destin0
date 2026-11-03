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
import { sendTabMessage } from "@/application/economy/tab-messages";
import {
  consumptionFormSchema,
  economyConsumptionIdSchema,
  economyEventIdSchema,
  economyReservationIdSchema,
  guestSlotSchema,
  readConsumptionFormData,
} from "@/contracts/admin-economy";
import { requireAdmin, requirePermission } from "@/infrastructure/auth/require-admin";
import { postgresEconomyRepository } from "@/infrastructure/db/repositories/postgres-economy-repository";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { drainMessagesNow } from "@/infrastructure/messaging/drain-message-outbox";
import { consumeAdminMessageRateLimit } from "@/infrastructure/rate-limit/admin-message-rate-limit";

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

export async function sendTabAction(
  eventId: string,
  reservationId: string,
  slot: number,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  if (!authorization.authorized) {
    return authorization.error === "FORBIDDEN"
      ? { ok: false, message: "Solo un superadministrador puede enviar mensajes." }
      : UNAUTHORIZED;
  }

  const reference = tabReferenceSchema.safeParse({ eventId, reservationId, slot });
  if (!reference.success) return { ok: false, message: reference.error.issues[0]!.message };

  const result = await sendTabMessage(
    {
      consumeRateLimit: consumeAdminMessageRateLimit,
      enqueueTabMessage: (input) => postgresMessageRepository.enqueueTabMessage(input),
      deliver: (ids) => drainMessagesNow(ids, { timeBudgetMs: 6_000 }),
      getDeliveryState: (id) => postgresMessageRepository.getDeliveryState(id),
    },
    {
      eventId: reference.data.eventId,
      reservationId: reference.data.reservationId,
      text: String(formData.get("text") ?? ""),
      adminId: authorization.session.admin.id,
    },
  );
  if (!result.ok) {
    const messages = {
      INVALID_TEXT: "La cuenta debe tener entre 1 y 2000 caracteres.",
      RATE_LIMITED: "Alcanzaste el límite de mensajes. Intenta de nuevo más tarde.",
      RESERVATION_NOT_FOUND: "No se encontró la reservación.",
    };
    return { ok: false, message: messages[result.error] };
  }

  revalidateEconomyPaths(reference.data.eventId);
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin/mensajes/sin-enviar");
  if (result.status === "SENT" || result.status === "READ") {
    return { ok: true, message: "Cuenta enviada por Instagram." };
  }
  if (result.status === "QUEUED") {
    return { ok: true, message: "La cuenta quedó en cola de envío." };
  }
  if (result.status === "WAITING_CONTACT") {
    return {
      ok: true,
      message:
        "La cuenta saldrá cuando la persona nos escriba por Instagram. También puedes enviarla a mano desde Mensajes > Sin enviar.",
    };
  }
  if (result.status === "WAITING_WINDOW") {
    return {
      ok: true,
      message:
        "La ventana de 24 horas está cerrada: la cuenta saldrá cuando la persona vuelva a escribir. También puedes enviarla a mano desde Mensajes > Sin enviar.",
    };
  }
  return {
    ok: false,
    message: "No se pudo enviar por Instagram. Envíala a mano desde Mensajes > Sin enviar.",
  };
}
