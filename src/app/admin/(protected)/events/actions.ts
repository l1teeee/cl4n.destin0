"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import {
  cancelEvent,
  changeCapacity,
  changeWaitlistCapacity,
  closeEventNow,
  completeEvent,
  createEvent,
  openEventNow,
  publishEvent,
  setLocationStatus,
  updateEvent,
} from "@/application/events/event-use-cases";
import { sendEventLocation } from "@/application/events/event-location-email";
import type {
  EventOperationErrorCode,
  EventRecord,
  LoadedLocationVersion,
} from "@/application/events/types";
import { createCancelReservation } from "@/application/reservations/cancel-reservation";
import { createCancelWaitlistEntry } from "@/application/reservations/cancel-waitlist-entry";
import {
  changeWaitlistCapacitySchema,
  createAdminEventSchema,
  updateAdminEventSchema,
} from "@/contracts/admin-event";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { postgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";
import { googleMapsLinkResolver } from "@/infrastructure/maps/google-maps-link-resolver";
import { postgresEventLocationEmailRepository } from "@/infrastructure/db/repositories/postgres-event-location-email-repository";
import { scheduleEmailDelivery } from "@/infrastructure/email/outbox/schedule-email-delivery";
import { PostgresReservationAllocationRepository } from "@/infrastructure/db/repositories/reservation-allocation-repository";
import {
  localDateTimeToUtc,
  localEventDateTimeToUtc,
} from "@/infrastructure/time/el-salvador-time";

export interface AdminActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<string, string>>;
}

const idSchema = z.object({ id: z.string().uuid("El identificador no es válido.") }).strict();
const reservationActionSchema = z
  .object({
    eventId: z.string().uuid("El evento no es válido."),
    reservationId: z.string().uuid("La reservación no es válida."),
  })
  .strict();
const waitlistActionSchema = z
  .object({
    eventId: z.string().uuid("El evento no es válido."),
    waitlistEntryId: z.string().uuid("La entrada en cola no es válida."),
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
const locationStatusSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["PENDING", "CONFIRMED"]),
    loadedRevision: z.number().int().min(0),
    loadedStatus: z.enum(["PENDING", "CONFIRMED"]),
  })
  .strict();
const imageActionSchema = z
  .object({ eventId: z.string().uuid(), imageId: z.string().uuid() })
  .strict();
// The budget is only checked before each claim; the 20 s margin inside maxDuration = 60 covers
// one send (up to 8 s) plus the action and page re-render, so the function is never killed
// between the provider accepting a send and markSent, which would duplicate the email.
const LOCATION_EMAIL_DRAIN_TIME_BUDGET_MS = 40_000;
const LOCATION_EMAIL_DRAIN_LIMIT = 100;

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
  LOCATION_CONFIRMATION_INCOMPLETE:
    "Para confirmar la ubicación agrega la dirección o el enlace de Google Maps.",
  LOCATION_CHANGED:
    "La ubicación cambió mientras editabas. Recarga la página para ver la versión actual.",
};

const operationErrorFields: Partial<Record<EventOperationErrorCode, string>> = {
  SLUG_TAKEN: "slug",
  SLUG_LOCKED: "slug",
  MAX_PARTY_SIZE_ABOVE_CAPACITY: "maxPartySize",
  INVALID_WINDOW: "closesAt",
  LOCATION_CONFIRMATION_INCOMPLETE: "locationAddress",
};

// Number("") is 0, which would silently turn an empty field into "waitlist off".
function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return Number(value);
}

function unauthorized(): AdminActionState {
  return { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
}

function invalid(message: string): AdminActionState {
  return { ok: false, message };
}

function operationError(error: EventOperationErrorCode): AdminActionState {
  const message = operationMessages[error];
  const field = operationErrorFields[error];
  return {
    ok: false,
    message,
    fieldErrors: field ? { [field]: message } : undefined,
  };
}

function firstValidationError(error: z.ZodError): AdminActionState {
  return invalid(error.issues[0]?.message ?? "Revisa los datos del formulario.");
}

function formValidationError(error: z.ZodError): AdminActionState {
  return {
    ok: false,
    message: "Revisa los campos marcados.",
    fieldErrors: fieldErrorsFromZod(error),
  };
}

function dateConversionError(error: unknown, field: string): AdminActionState {
  const message = error instanceof Error ? error.message : "Las fechas no son válidas.";
  return {
    ok: false,
    message,
    fieldErrors: { [field]: message },
  };
}

const MAPS_LINK_CLEARED_MESSAGE =
  "Experiencia actualizada. Se quitó el enlace de Google Maps anterior porque cambió la dirección.";
const MAPS_POINT_MISSING_MESSAGE =
  "No se pudo leer el punto exacto del enlace; el mapa usará la dirección.";

function updateSuccessMessage(submittedMapsUrl: string | null, saved: EventRecord): string {
  const mapsUrlCleared = submittedMapsUrl !== null && saved.location.mapsUrl === null;
  if (mapsUrlCleared) return MAPS_LINK_CLEARED_MESSAGE;
  const message = "Experiencia actualizada correctamente.";
  const pointMissing = saved.location.mapsUrl !== null && saved.location.latitude === null;
  return pointMissing ? `${message} ${MAPS_POINT_MISSING_MESSAGE}` : message;
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
    capacity: optionalNumber(formData.get("capacity")),
    maxPartySize: optionalNumber(formData.get("maxPartySize")),
    autoCloseOnFull: formData.get("autoCloseOnFull") === "on",
    waitlistCapacity: optionalNumber(formData.get("waitlistCapacity")),
    status: formData.get("status"),
    locationName: formData.get("locationName"),
    locationAddress: formData.get("locationAddress"),
    locationMapsUrl: formData.get("locationMapsUrl"),
    locationNotes: formData.get("locationNotes"),
    locationStatus: formData.get("locationStatus"),
  });
  if (!parsed.success) return formValidationError(parsed.error);

  let startsAt: Date;
  let opensAt: Date;
  let closesAt: Date;
  try {
    startsAt = localEventDateTimeToUtc(parsed.data.eventDate, parsed.data.eventTime);
  } catch (error) {
    return dateConversionError(error, "eventDate");
  }
  try {
    opensAt = localDateTimeToUtc(parsed.data.opensAt);
  } catch (error) {
    return dateConversionError(error, "opensAt");
  }
  try {
    closesAt = localDateTimeToUtc(parsed.data.closesAt);
  } catch (error) {
    return dateConversionError(error, "closesAt");
  }

  const result = await createEvent(
    postgresEventRepository,
    googleMapsLinkResolver,
    {
      ...parsed.data,
      startsAt,
      opensAt,
      closesAt,
      location: {
        name: parsed.data.locationName,
        address: parsed.data.locationAddress,
        mapsUrl: parsed.data.locationMapsUrl,
        notes: parsed.data.locationNotes,
        status: parsed.data.locationStatus,
      },
    },
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);

  revalidateEventPaths(result.value.id, result.value.slug);
  redirect(`/admin/events/${result.value.id}`);
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
    maxPartySize: optionalNumber(formData.get("maxPartySize")),
    autoCloseOnFull: formData.get("autoCloseOnFull") === "on",
    locationName: formData.get("locationName"),
    locationAddress: formData.get("locationAddress"),
    locationMapsUrl: formData.get("locationMapsUrl"),
    locationNotes: formData.get("locationNotes"),
    locationStatus: formData.get("locationStatus"),
    keepMapsUrl: formData.get("keepMapsUrl") === "on",
    locationRevision: formData.get("locationRevision"),
    locationStatusLoaded: formData.get("locationStatusLoaded"),
  });
  if (!parsed.success) return formValidationError(parsed.error);

  let startsAt: Date;
  let opensAt: Date;
  let closesAt: Date;
  try {
    startsAt = localEventDateTimeToUtc(parsed.data.eventDate, parsed.data.eventTime);
  } catch (error) {
    return dateConversionError(error, "eventDate");
  }
  try {
    opensAt = localDateTimeToUtc(parsed.data.opensAt);
  } catch (error) {
    return dateConversionError(error, "opensAt");
  }
  try {
    closesAt = localDateTimeToUtc(parsed.data.closesAt);
  } catch (error) {
    return dateConversionError(error, "closesAt");
  }

  const result = await updateEvent(
    postgresEventRepository,
    googleMapsLinkResolver,
    {
      id: parsedId.data.id,
      ...parsed.data,
      startsAt,
      opensAt,
      closesAt,
      location: {
        name: parsed.data.locationName,
        address: parsed.data.locationAddress,
        mapsUrl: parsed.data.locationMapsUrl,
        notes: parsed.data.locationNotes,
        status: parsed.data.locationStatus,
      },
      expectedLocation: {
        revision: parsed.data.locationRevision,
        status: parsed.data.locationStatusLoaded,
      },
    },
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);

  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: updateSuccessMessage(parsed.data.locationMapsUrl, result.value) };
}

export async function setEventLocationStatusAction(
  id: string,
  status: "PENDING" | "CONFIRMED",
  loadedLocation: LoadedLocationVersion,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = locationStatusSchema.safeParse({
    id,
    status,
    loadedRevision: loadedLocation.revision,
    loadedStatus: loadedLocation.status,
  });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await setLocationStatus(
    postgresEventRepository,
    parsed.data.id,
    parsed.data.status,
    { revision: parsed.data.loadedRevision, status: parsed.data.loadedStatus },
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Estado de la ubicación actualizado." };
}

export async function sendEventLocationAction(
  id: string,
  loadedLocation: LoadedLocationVersion,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) return firstValidationError(parsed.error);

  const result = await sendEventLocation(
    postgresEventLocationEmailRepository,
    parsed.data.id,
    loadedLocation,
    authorization.session.admin.id,
  );
  if (!result.ok && result.error === "EVENT_NOT_FOUND") {
    return invalid("No se encontró la experiencia.");
  }
  if (!result.ok && result.error === "TRY_AGAIN") {
    return invalid(
      "Hay reservas entrando en este momento. Intenta enviar de nuevo en unos segundos.",
    );
  }
  if (!result.ok && result.error === "LOCATION_CHANGED") {
    return operationError("LOCATION_CHANGED");
  }
  if (!result.ok) return invalid("Confirma la ubicación antes de enviarla.");

  if (result.queued > 0) {
    scheduleEmailDelivery({
      limit: Math.min(result.queued, LOCATION_EMAIL_DRAIN_LIMIT),
      timeBudgetMs: LOCATION_EMAIL_DRAIN_TIME_BUDGET_MS,
    });
  }
  revalidatePath(`/admin/events/${parsed.data.id}`);
  revalidatePath("/admin/emails");
  if (result.queued === 0) {
    return { ok: true, message: "Todas las personas confirmadas ya tienen esta ubicación." };
  }
  return { ok: true, message: `Se encolaron ${result.queued} correos de ubicación.` };
}

export async function processPendingLocationEmailsAction(
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

  scheduleEmailDelivery({
    limit: LOCATION_EMAIL_DRAIN_LIMIT,
    timeBudgetMs: LOCATION_EMAIL_DRAIN_TIME_BUDGET_MS,
  });
  revalidatePath(`/admin/events/${parsed.data.id}`);
  revalidatePath("/admin/emails");
  return { ok: true, message: "Se programó el procesamiento de los correos pendientes." };
}

export async function deleteEventImageAction(
  eventId: string,
  imageId: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = imageActionSchema.safeParse({ eventId, imageId });
  if (!parsed.success) return firstValidationError(parsed.error);
  const removed = await postgresEventImageRepository.remove(
    parsed.data.eventId,
    parsed.data.imageId,
    authorization.session.admin.id,
  );
  if (!removed) return invalid("No se encontró la imagen.");
  revalidateEventPaths(parsed.data.eventId);
  return { ok: true, message: "Imagen eliminada." };
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
  scheduleEmailDelivery();
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Capacidad actualizada." };
}

export async function changeWaitlistCapacityAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return unauthorized();
  const parsed = changeWaitlistCapacitySchema.safeParse({
    id,
    waitlistCapacity: optionalNumber(formData.get("waitlistCapacity")),
  });
  if (!parsed.success) return firstValidationError(parsed.error);
  const result = await changeWaitlistCapacity(
    postgresEventRepository,
    parsed.data.id,
    parsed.data.waitlistCapacity,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidateEventPaths(result.value.id, result.value.slug);
  return { ok: true, message: "Cola actualizada." };
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
  scheduleEmailDelivery();
  revalidatePath("/admin");
  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  revalidatePath("/admin/audit");
  return { ok: true, message: "Reservación cancelada." };
}

export async function cancelWaitlistEntryAction(
  eventId: string,
  waitlistEntryId: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = waitlistActionSchema.safeParse({ eventId, waitlistEntryId });
  if (!parsed.success) return firstValidationError(parsed.error);

  const cancelWaitlistEntry = createCancelWaitlistEntry(
    new PostgresReservationAllocationRepository(),
  );
  const result = await cancelWaitlistEntry({
    waitlistEntryId: parsed.data.waitlistEntryId,
    actorAdminId: authorization.session.admin.id,
  });
  if (result === "NOT_FOUND") return invalid("No se encontró la entrada en cola.");
  if (result === "NOT_CANCELLABLE") return invalid("La entrada ya no se puede retirar.");

  scheduleEmailDelivery();
  revalidatePath("/admin");
  revalidatePath(`/admin/events/${parsed.data.eventId}`);
  revalidatePath("/admin/audit");
  return {
    ok: true,
    message:
      "Entrada retirada de la cola. Si se liberó espacio, la siguiente persona entró automáticamente y recibió su correo.",
  };
}
