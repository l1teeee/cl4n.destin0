"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  cancelEvent,
  changeCapacity,
  closeEventNow,
  completeEvent,
  createEvent,
  openEventNow,
  publishEvent,
  updateEvent,
} from "@/application/events/event-use-cases";
import type { EventOperationErrorCode } from "@/application/events/types";
import { createCancelReservation } from "@/application/reservations/cancel-reservation";
import { createAdminEventSchema, updateAdminEventSchema } from "@/contracts/admin-event";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import {
  localDateTimeToUtc,
  localEventDateTimeToUtc,
} from "@/infrastructure/time/el-salvador-time";

export interface AdminActionState {
  ok: boolean;
  message: string;
}

const idSchema = z.object({ id: z.string().uuid("El identificador no es válido.") }).strict();
const reservationActionSchema = z
  .object({
    eventId: z.string().uuid("El evento no es válido."),
    reservationId: z.string().uuid("La reservación no es válida."),
  })
  .strict();
const capacitySchema = z
  .object({
    id: z.string().uuid("El identificador no es válido."),
    newCapacity: z
      .number({ error: "La capacidad debe ser un número." })
      .int("La capacidad debe ser un número entero.")
      .positive("La capacidad debe ser mayor que cero."),
  })
  .strict();

const operationMessages: Record<EventOperationErrorCode, string> = {
  EVENT_NOT_FOUND: "No se encontró la experiencia.",
  SLUG_TAKEN: "Ese slug ya está en uso.",
  SLUG_LOCKED: "El slug solo puede cambiarse mientras la experiencia está en borrador.",
  MAX_PARTY_SIZE_ABOVE_CAPACITY: "El tamaño máximo del grupo supera la capacidad.",
  INVALID_WINDOW: "La fecha de cierre debe ser posterior a la fecha de apertura.",
  INVALID_TRANSITION: "La experiencia ya no permite esta acción.",
  CLOSES_AT_IN_PAST: "No se puede abrir una experiencia cuya fecha de cierre ya pasó.",
  CAPACITY_BELOW_ALLOCATED: "La capacidad no puede ser menor que los cupos reservados.",
  CAPACITY_BELOW_MAX_PARTY_SIZE: "La capacidad no puede ser menor que el tamaño máximo del grupo.",
  WAITLIST_CAPACITY_BELOW_WAITING: "No puedes dejar menos lugares en cola que personas esperando.",
};

function unauthorized(): AdminActionState {
  return { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
}

function invalid(message: string): AdminActionState {
  return { ok: false, message };
}

function operationError(error: EventOperationErrorCode): AdminActionState {
  return invalid(operationMessages[error]);
}

function firstValidationError(error: z.ZodError): AdminActionState {
  return invalid(error.issues[0]?.message ?? "Revisa los datos del formulario.");
}

function revalidateEventPaths(id: string, slug?: string): void {
  revalidatePath("/admin");
  revalidatePath(`/admin/events/${id}`);
  revalidatePath(`/admin/events/${id}/edit`);
  revalidatePath("/admin/audit");
  if (slug) {
    revalidatePath("/");
    revalidatePath(`/solicitar/${slug}`);
  }
}

export async function createEventAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return unauthorized();

  const parsed = createAdminEventSchema.safeParse({
    internalName: formData.get("internalName"),
    slug: formData.get("slug"),
    eventDate: formData.get("eventDate"),
    eventTime: formData.get("eventTime"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    capacity: Number(formData.get("capacity")),
    maxPartySize: Number(formData.get("maxPartySize")),
    autoCloseOnFull: formData.get("autoCloseOnFull") === "on",
    waitlistCapacity: Number(formData.get("waitlistCapacity")),
    status: formData.get("status"),
  });
  if (!parsed.success) return firstValidationError(parsed.error);

  let startsAt: Date;
  let opensAt: Date;
  let closesAt: Date;
  try {
    startsAt = localEventDateTimeToUtc(parsed.data.eventDate, parsed.data.eventTime);
    opensAt = localDateTimeToUtc(parsed.data.opensAt);
    closesAt = localDateTimeToUtc(parsed.data.closesAt);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Las fechas no son válidas.");
  }

  const result = await createEvent(
    postgresEventRepository,
    { ...parsed.data, startsAt, opensAt, closesAt },
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);

  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Experiencia creada correctamente." };
}

export async function updateEventAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return unauthorized();

  const parsedId = idSchema.safeParse({ id });
  if (!parsedId.success) return firstValidationError(parsedId.error);
  const parsed = updateAdminEventSchema.safeParse({
    internalName: formData.get("internalName"),
    slug: formData.get("slug"),
    eventDate: formData.get("eventDate"),
    eventTime: formData.get("eventTime"),
    opensAt: formData.get("opensAt"),
    closesAt: formData.get("closesAt"),
    maxPartySize: Number(formData.get("maxPartySize")),
    autoCloseOnFull: formData.get("autoCloseOnFull") === "on",
    waitlistCapacity: Number(formData.get("waitlistCapacity")),
  });
  if (!parsed.success) return firstValidationError(parsed.error);

  let startsAt: Date;
  let opensAt: Date;
  let closesAt: Date;
  try {
    startsAt = localEventDateTimeToUtc(parsed.data.eventDate, parsed.data.eventTime);
    opensAt = localDateTimeToUtc(parsed.data.opensAt);
    closesAt = localDateTimeToUtc(parsed.data.closesAt);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Las fechas no son válidas.");
  }

  const result = await updateEvent(
    postgresEventRepository,
    { id: parsedId.data.id, ...parsed.data, startsAt, opensAt, closesAt },
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);

  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Experiencia actualizada correctamente." };
}

export async function publishEventAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await publishEvent(
    postgresEventRepository,
    parsed.data.id,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Experiencia publicada." };
}

export async function openEventNowAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await openEventNow(
    postgresEventRepository,
    parsed.data.id,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Experiencia abierta." };
}

export async function closeEventNowAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await closeEventNow(
    postgresEventRepository,
    parsed.data.id,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Experiencia cerrada." };
}

export async function completeEventAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await completeEvent(
    postgresEventRepository,
    parsed.data.id,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Experiencia completada." };
}

export async function cancelEventAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await cancelEvent(
    postgresEventRepository,
    parsed.data.id,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Experiencia cancelada." };
}

export async function changeCapacityAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return unauthorized();
  const parsed = capacitySchema.safeParse({ id, newCapacity: Number(formData.get("newCapacity")) });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await changeCapacity(
    postgresEventRepository,
    parsed.data.id,
    parsed.data.newCapacity,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Capacidad actualizada." };
}

export async function cancelReservationAction(
  eventId: string,
  reservationId: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = reservationActionSchema.safeParse({ eventId, reservationId });
  if (!parsed.success) return firstValidationError(parsed.error);
  const cancelReservation = createCancelReservation(new PostgresReservationAllocationRepository());
  const result = await cancelReservation({
    reservationId: parsed.data.reservationId,
    actorAdminId: authorization.session.admin.id,
  });
  if (result === "NOT_FOUND") return invalid("No se encontró la reservación.");
  if (result === "NOT_CANCELLABLE") return invalid("La reservación ya no se puede cancelar.");
  revalidatePath("/admin");
  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  revalidatePath("/admin/audit");
  return { ok: true, message: "Reservación cancelada." };
}
