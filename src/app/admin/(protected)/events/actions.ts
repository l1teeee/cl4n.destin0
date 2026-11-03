"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import { removeEventClue, sendClueToAll, sendClueToPerson } from "@/application/events/event-clues";
import { resolveCreateSchedule, resolveUpdateSchedule } from "@/application/events/event-schedule";
import {
  cancelEvent,
  changeCapacity,
  changeWaitlistCapacity,
  closeEventNow,
  completeEvent,
  createEvent,
  deleteEvent,
  openEventNow,
  publishEvent,
  reopenEvent,
  setLocationStatus,
  updateEvent,
} from "@/application/events/event-use-cases";
import type { SendLocationError } from "@/application/events/location-message-repository";
import type {
  EventOperationErrorCode,
  EventRecord,
  LoadedLocationVersion,
} from "@/application/events/types";
import type { MessageDeliverySummary } from "@/application/messaging/deliver-messages";
import {
  changeWaitlistCapacitySchema,
  createAdminEventSchema,
  optionalNumber,
  readCreateEventFormData,
  reopenEventSchema,
  updateAdminEventSchema,
} from "@/contracts/admin-event";
import type { ScheduleErrors } from "@/domain/event/event-schedule";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { postgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { postgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";
import { googleMapsLinkResolver } from "@/infrastructure/maps/google-maps-link-resolver";
import { postgresLocationMessageRepository } from "@/infrastructure/db/repositories/postgres-location-message-repository";
import { scheduleEmailDelivery } from "@/infrastructure/email/outbox/schedule-email-delivery";
import { drainMessagesNow } from "@/infrastructure/messaging/drain-message-outbox";
import { scheduleMessageDelivery } from "@/infrastructure/messaging/schedule-message-delivery";
import { log } from "@/infrastructure/observability/logger";
import {
  formatUtcForElSalvador,
  localDateTimeToUtc,
  localEventDateTimeToUtc,
} from "@/infrastructure/time/el-salvador-time";

import { describeLocationSend } from "./location-send-summary";

export interface AdminActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<string, string>>;
}

const idSchema = z.object({ id: z.string().uuid("El identificador no es válido.") }).strict();
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
const INVALID_LOCATION_VERSION = "La versión de la ubicación no es válida.";
const locationSendSchema = z
  .object({
    id: z.string().uuid("El identificador no es válido."),
    loadedRevision: z
      .number({ error: INVALID_LOCATION_VERSION })
      .int(INVALID_LOCATION_VERSION)
      .min(0, INVALID_LOCATION_VERSION),
    loadedStatus: z.enum(["PENDING", "CONFIRMED"], { error: INVALID_LOCATION_VERSION }),
  })
  .strict();
const imageActionSchema = z
  .object({ eventId: z.string().uuid(), imageId: z.string().uuid() })
  .strict();
const clueActionSchema = z
  .object({ eventId: z.string().uuid(), clueId: z.string().uuid() })
  .strict();
const LOCATION_DELIVERY_TIME_BUDGET_MS = 6_000;

const operationMessages: Record<EventOperationErrorCode, string> = {
  EVENT_NOT_FOUND: "No se encontró la experiencia.",
  SLUG_TAKEN: "Ese slug ya está en uso.",
  SLUG_LOCKED: "El slug solo puede cambiarse mientras la experiencia está en borrador.",
  MAX_PARTY_SIZE_NOT_ALLOWED: "Máximo 2 personas por solicitud.",
  MAX_PARTY_SIZE_ABOVE_CAPACITY: "El tamaño máximo del grupo supera la capacidad.",
  INVALID_WINDOW: "La fecha de cierre debe ser posterior a la fecha de apertura.",
  INVALID_TRANSITION: "La experiencia ya no permite esta acción.",
  CLOSES_AT_IN_PAST: "No se puede abrir una experiencia cuya fecha de cierre ya pasó.",
  CLOSES_AFTER_START: "La fecha de cierre debe ser antes del inicio de la experiencia.",
  CAPACITY_BELOW_ALLOCATED: "La capacidad no puede ser menor que los cupos reservados.",
  CAPACITY_BELOW_MAX_PARTY_SIZE: "La capacidad no puede ser menor que el tamaño máximo del grupo.",
  WAITLIST_CAPACITY_BELOW_WAITING: "No puedes dejar menos lugares en cola que personas esperando.",
  EVENT_ACCEPTING_RESERVATIONS:
    "La experiencia está recibiendo reservaciones. Ciérrala antes de eliminarla.",
  LOCATION_CONFIRMATION_INCOMPLETE:
    "Para confirmar la ubicación agrega la dirección o el enlace de Google Maps.",
  LOCATION_CHANGED:
    "La ubicación cambió mientras editabas. Recarga la página para ver la versión actual.",
};

const locationSendMessages: Record<SendLocationError, string> = {
  EVENT_NOT_FOUND: operationMessages.EVENT_NOT_FOUND,
  EVENT_NOT_EDITABLE: "La experiencia ya no admite envíos.",
  LOCATION_NOT_CONFIRMED: "Confirma la ubicación antes de enviarla.",
  LOCATION_CHANGED: operationMessages.LOCATION_CHANGED,
  LOCATION_TOO_LONG:
    "La ubicación es demasiado larga para un mensaje de Instagram. Acorta las indicaciones o el enlace.",
  TRY_AGAIN: "Hay reservas entrando en este momento. Intenta enviar de nuevo en unos segundos.",
};

const clueSendMessages = {
  EVENT_NOT_FOUND: operationMessages.EVENT_NOT_FOUND,
  CLUES_CLOSED: "Las pistas solo se pueden enviar mientras la experiencia está cerrada.",
  CLUE_NOT_FOUND: "No se encontró la pista.",
  GUEST_NOT_ELIGIBLE: "Solo se puede enviar a invitados con pago verificado.",
} as const;

const operationErrorFields: Partial<Record<EventOperationErrorCode, string>> = {
  SLUG_TAKEN: "slug",
  SLUG_LOCKED: "slug",
  MAX_PARTY_SIZE_NOT_ALLOWED: "maxPartySize",
  MAX_PARTY_SIZE_ABOVE_CAPACITY: "maxPartySize",
  INVALID_WINDOW: "closesAt",
  CLOSES_AFTER_START: "closesAt",
  LOCATION_CONFIRMATION_INCOMPLETE: "locationAddress",
};

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

function scheduleError(errors: ScheduleErrors): AdminActionState {
  const fieldErrors: Partial<Record<string, string>> = {};
  if (errors.startsAt) fieldErrors.eventDate = errors.startsAt;
  if (errors.opensAt) fieldErrors.opensAt = errors.opensAt;
  if (errors.closesAt) fieldErrors.closesAt = errors.closesAt;
  return { ok: false, message: "Revisa los campos marcados.", fieldErrors };
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

function revalidateCluePaths(id: string): void {
  revalidatePath(`/admin/events/${id}`);
  revalidatePath("/admin/audit");
}

export async function createEventAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return unauthorized();

  const parsed = createAdminEventSchema.safeParse(readCreateEventFormData(formData));
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

  const schedule = await resolveCreateSchedule(postgresEventRepository, {
    startsAt,
    opensAt,
    closesAt,
    openNow: parsed.data.openNow,
  });
  if (!schedule.ok) return scheduleError(schedule.errors);

  const result = await createEvent(
    postgresEventRepository,
    googleMapsLinkResolver,
    {
      ...parsed.data,
      startsAt,
      opensAt: schedule.opensAt,
      closesAt,
      location: {
        name: parsed.data.locationName,
        address: parsed.data.locationAddress,
        mapsUrl: parsed.data.locationMapsUrl,
        wazeUrl: parsed.data.locationWazeUrl,
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
    openNow: formData.get("openNow") === "1",
    maxPartySize: optionalNumber(formData.get("maxPartySize")),
    autoCloseOnFull: formData.get("autoCloseOnFull") === "on",
    paymentInstructions: formData.has("paymentInstructions")
      ? formData.get("paymentInstructions")
      : undefined,
    price: formData.get("price"),
    locationName: formData.get("locationName"),
    locationAddress: formData.get("locationAddress"),
    locationMapsUrl: formData.get("locationMapsUrl"),
    locationWazeUrl: formData.has("locationWazeUrl") ? formData.get("locationWazeUrl") : undefined,
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

  const schedule = await resolveUpdateSchedule(postgresEventRepository, parsedId.data.id, {
    startsAt,
    opensAt,
    closesAt,
    openNow: parsed.data.openNow,
  });
  if (!schedule.ok) return scheduleError(schedule.errors);

  const result = await updateEvent(
    postgresEventRepository,
    googleMapsLinkResolver,
    {
      id: parsedId.data.id,
      ...parsed.data,
      startsAt,
      opensAt: schedule.opensAt,
      closesAt,
      location: {
        name: parsed.data.locationName,
        address: parsed.data.locationAddress,
        mapsUrl: parsed.data.locationMapsUrl,
        wazeUrl: parsed.data.locationWazeUrl,
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
  const parsed = locationSendSchema.safeParse({
    id,
    loadedRevision: loadedLocation.revision,
    loadedStatus: loadedLocation.status,
  });
  if (!parsed.success) return firstValidationError(parsed.error);

  const result = await postgresLocationMessageRepository.sendLocationToPaidGuests(
    parsed.data.id,
    { revision: parsed.data.loadedRevision, status: parsed.data.loadedStatus },
    authorization.session.admin.id,
  );
  if (!result.ok) return invalid(locationSendMessages[result.error]);

  const delivery = await deliverLocationMessages(result.messageIds);
  scheduleMessageDelivery();
  revalidatePath(`/admin/events/${parsed.data.id}`);
  revalidatePath("/admin/mensajes");
  if (!delivery) {
    const count = result.messageIds.length;
    const people = count === 1 ? "1 persona" : `${count} personas`;
    return { ok: true, message: `Ubicación en cola para ${people}; se enviará en unos minutos.` };
  }
  return {
    ok: true,
    message: describeLocationSend(
      result.messageIds,
      delivery.outcomes,
      await pendingAfterEmptySend(parsed.data.id, result.messageIds),
    ),
  };
}

export async function sendEventLocationToPeopleAction(
  eventId: string,
  expectedLocation: LoadedLocationVersion,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return unauthorized();
  const parsed = locationSendSchema.safeParse({
    id: eventId,
    loadedRevision: expectedLocation.revision,
    loadedStatus: expectedLocation.status,
  });
  if (!parsed.success) return firstValidationError(parsed.error);
  const selected = z
    .array(z.string().regex(/^[0-9a-f-]{36}:[12]$/i))
    .min(1)
    .safeParse(formData.getAll("people"));
  if (!selected.success) return invalid("Elige personas válidas para el envío.");
  const people = selected.data.map((value) => {
    const [reservationId, slot] = value.split(":");
    return { reservationId, slot: Number(slot) };
  });
  const validated = z
    .array(
      z.object({
        reservationId: z.string().uuid(),
        slot: z.union([z.literal(1), z.literal(2)]),
      }),
    )
    .safeParse(people);
  if (!validated.success) return invalid("Elige personas válidas para el envío.");
  const result = await postgresLocationMessageRepository.sendLocationToPeople(
    parsed.data.id,
    { revision: parsed.data.loadedRevision, status: parsed.data.loadedStatus },
    validated.data,
    authorization.session.admin.id,
  );
  if (!result.ok) return invalid(locationSendMessages[result.error]);
  const delivery = await deliverLocationMessages(result.messageIds);
  scheduleMessageDelivery();
  revalidatePath(`/admin/events/${parsed.data.id}`);
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin/mensajes/sin-enviar");
  if (!delivery) {
    const count = result.messageIds.length;
    const recipients = count === 1 ? "1 persona" : `${count} personas`;
    return {
      ok: true,
      message: `Ubicación en cola para ${recipients}; se enviará en unos minutos.`,
    };
  }
  return {
    ok: true,
    message: describeLocationSend(
      result.messageIds,
      delivery.outcomes,
      await pendingAfterEmptySend(parsed.data.id, result.messageIds),
    ),
  };
}

// An empty send must not claim that everybody has the location while earlier messages are pending.
async function pendingAfterEmptySend(
  eventId: string,
  messageIds: readonly string[],
): Promise<number> {
  if (messageIds.length > 0) return 0;
  const summary = await postgresLocationMessageRepository.getLocationDeliverySummary(eventId);
  return summary.pending;
}

// The send is already committed, so a delivery problem must not turn it into an error: the queued
// messages are retried by the scheduled drain and by the daily cron.
async function deliverLocationMessages(
  messageIds: readonly string[],
): Promise<Pick<MessageDeliverySummary, "outcomes"> | null> {
  if (messageIds.length === 0) return { outcomes: {} };
  try {
    return await drainMessagesNow(messageIds, { timeBudgetMs: LOCATION_DELIVERY_TIME_BUDGET_MS });
  } catch {
    log("error", "location_immediate_delivery_failed", { messageCount: messageIds.length });
    return null;
  }
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

export async function deleteEventClueAction(
  eventId: string,
  clueId: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();

  const parsed = clueActionSchema.safeParse({ eventId, clueId });
  if (!parsed.success) return formValidationError(parsed.error);
  const result = await removeEventClue(postgresEventRepository, postgresEventClueRepository, {
    eventId: parsed.data.eventId,
    clueId: parsed.data.clueId,
    actorId: authorization.session.admin.id,
  });
  if (!result.ok) {
    const messages = {
      EVENT_NOT_FOUND: "No se encontró la experiencia.",
      CLUE_NOT_FOUND: "No se encontró la pista.",
      CLUES_CLOSED:
        "Las pistas solo se pueden publicar o borrar mientras la experiencia está cerrada.",
    } as const;
    return invalid(messages[result.error]);
  }

  revalidateCluePaths(parsed.data.eventId);
  return { ok: true, message: "Pista eliminada." };
}

export async function sendClueToAllAction(
  eventId: string,
  clueId: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();

  const parsed = clueActionSchema.safeParse({ eventId, clueId });
  if (!parsed.success) return formValidationError(parsed.error);
  const result = await sendClueToAll(postgresEventRepository, postgresEventClueRepository, {
    ...parsed.data,
    actorId: authorization.session.admin.id,
  });
  if (!result.ok) return invalid(clueSendMessages[result.error]);

  await deliverClueMessages(result.messageIds);
  revalidateEventPaths(parsed.data.eventId);
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin/mensajes/sin-enviar");
  const count = result.messageIds.length;
  const message =
    count === 0
      ? "Todos los invitados con pago verificado ya tienen esta pista."
      : `Pista enviada a ${count} ${count === 1 ? "invitado" : "invitados"}.`;
  return { ok: true, message };
}

export async function sendClueToPersonAction(
  eventId: string,
  clueId: string,
  reservationId: string,
  slot: 1 | 2,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();

  const parsed = clueActionSchema.safeParse({ eventId, clueId });
  if (!parsed.success) return formValidationError(parsed.error);
  const parsedReservation = z
    .object({ id: z.string().uuid(), slot: z.union([z.literal(1), z.literal(2)]) })
    .safeParse({ id: reservationId, slot });
  if (!parsedReservation.success) return formValidationError(parsedReservation.error);
  const result = await sendClueToPerson(postgresEventRepository, postgresEventClueRepository, {
    ...parsed.data,
    reservationId: parsedReservation.data.id,
    slot: parsedReservation.data.slot,
    actorId: authorization.session.admin.id,
  });
  if (!result.ok) return invalid(clueSendMessages[result.error]);

  await deliverClueMessages(result.messageIds);
  revalidateEventPaths(parsed.data.eventId);
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin/mensajes/sin-enviar");
  return {
    ok: true,
    message: result.messageIds.length > 0 ? "Pista enviada." : "Esta persona ya tiene esta pista.",
  };
}

const MAX_CLUE_RECIPIENTS = 100;
const cluePeopleSchema = z
  .array(z.string().regex(/^[0-9a-f-]{36}:[12]$/i))
  .min(1)
  .max(MAX_CLUE_RECIPIENTS);

export async function sendClueToPeopleAction(
  eventId: string,
  clueId: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return unauthorized();

  const parsed = clueActionSchema.safeParse({ eventId, clueId });
  if (!parsed.success) return formValidationError(parsed.error);
  const selected = cluePeopleSchema.safeParse(formData.getAll("person"));
  if (!selected.success) return invalid("Elige personas válidas para el envío.");
  const people = z
    .array(
      z.object({
        reservationId: z.string().uuid(),
        slot: z.union([z.literal(1), z.literal(2)]),
      }),
    )
    .safeParse(
      selected.data.map((value) => {
        const [reservationId, slot] = value.split(":");
        return { reservationId, slot: Number(slot) };
      }),
    );
  if (!people.success) return invalid("Elige personas válidas para el envío.");

  const messageIds: string[] = [];
  for (const person of people.data) {
    const result = await sendClueToPerson(postgresEventRepository, postgresEventClueRepository, {
      ...parsed.data,
      reservationId: person.reservationId,
      slot: person.slot,
      actorId: authorization.session.admin.id,
    });
    if (!result.ok) return invalid(clueSendMessages[result.error]);
    messageIds.push(...result.messageIds);
  }

  await deliverClueMessages(messageIds);
  revalidateEventPaths(parsed.data.eventId);
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin/mensajes/sin-enviar");
  const count = messageIds.length;
  return {
    ok: true,
    message:
      count === 0
        ? "Esas personas ya tienen esta pista."
        : `Pista enviada a ${count} ${count === 1 ? "persona" : "personas"}.`,
  };
}

// The send has committed; the scheduled drain and cron retry any delivery failure.
async function deliverClueMessages(messageIds: readonly string[]): Promise<void> {
  try {
    await drainMessagesNow(messageIds, { timeBudgetMs: 6_000 });
  } catch {
    log("error", "clue_message_delivery_failed");
  }
  scheduleMessageDelivery();
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

export async function reopenEventAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return unauthorized();
  const parsedId = idSchema.safeParse({ id });
  if (!parsedId.success) return firstValidationError(parsedId.error);
  const parsed = reopenEventSchema.safeParse({ closesAt: formData.get("closesAt") });
  if (!parsed.success) return formValidationError(parsed.error);

  let closesAt: Date;
  try {
    closesAt = localDateTimeToUtc(parsed.data.closesAt);
  } catch (error) {
    return dateConversionError(error, "closesAt");
  }

  const result = await reopenEvent(
    postgresEventRepository,
    parsedId.data.id,
    closesAt,
    authorization.session.admin.id,
  );
  if (!result.ok) {
    if (result.error === "CLOSES_AT_IN_PAST") {
      return {
        ok: false,
        message: "Revisa la fecha de cierre.",
        fieldErrors: { closesAt: "Elige una fecha y hora futura." },
      };
    }
    if (result.error === "CLOSES_AFTER_START") {
      return {
        ok: false,
        message: "Revisa la fecha de cierre.",
        fieldErrors: { closesAt: "Debe cerrar antes de que empiece la experiencia." },
      };
    }
    return operationError(result.error);
  }

  revalidateEventPaths(result.value.id, result.value.slug);
  return {
    ok: true,
    message: `Experiencia abierta hasta ${formatUtcForElSalvador(closesAt, "dd/MM/yyyy HH:mm")}.`,
  };
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

export async function deleteEventAction(
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
  const result = await deleteEvent(
    postgresEventRepository,
    parsed.data.id,
    authorization.session.admin.id,
  );
  if (!result.ok) return operationError(result.error);
  revalidatePath("/admin");
  revalidatePath("/admin/audit");
  revalidatePath("/");
  revalidatePath(`/solicitar/${result.value.slug}`);
  revalidatePath(`/admin/events/${result.value.id}`);
  return { ok: true, message: "Experiencia eliminada." };
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
  scheduleMessageDelivery();
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
