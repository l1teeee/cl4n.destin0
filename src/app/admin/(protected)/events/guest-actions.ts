"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type {
  GuestMutationFailure,
  GuestMutationSuccess,
} from "@/application/guests/guest-admin-repository";
import {
  acceptRequest,
  addRequest,
  cancelRequest,
  markRefunded,
  moveEntry,
  promoteEntry,
  rejectRequest,
  removeEntry,
  updateEntry,
  updateRequest,
  verifyPayment,
} from "@/application/guests/guest-admin-use-cases";
import {
  adminGuestFieldsSchema,
  adminGuestIdSchema,
  expectedCancellationStageSchema,
  moveEntryDirectionSchema,
  paymentNoteSchema,
  readAdminGuestFields,
  readReservationReplacement,
  readSendMessage,
  reservationReplacementSchema,
} from "@/contracts/admin-guest";
import { retryableDatabaseErrorCode } from "@/infrastructure/db/retryable-database-error";
import { postgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import { drainMessagesNow } from "@/infrastructure/messaging/drain-message-outbox";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { log } from "@/infrastructure/observability/logger";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";
import {
  acceptedResult,
  addedResult,
  cancelledResult,
  enteredFromQueueSentence,
  guestsLabel,
  paymentVerifiedResult,
  promotedFromQueueResult,
  refundedResult,
  rejectedResult,
  removedFromQueueResult,
  type MessageOutcome,
} from "@/ui/admin/guests/guest-copy";

const errorMessages: Record<GuestMutationFailure["code"], string> = {
  INVALID_STAGE: "La solicitud ya cambió de estado. Recarga la página.",
  WAITLIST_CHANGED:
    "La cola cambió mientras confirmabas. Revisa quién entra y vuelve a intentarlo.",
  REPLACEMENT_DOES_NOT_FIT: "La persona elegida no cabe en los lugares que se liberan.",
  NO_SEAT: "No hay un lugar libre para eso.",
  TRY_AGAIN: "La experiencia está muy ocupada. Intenta de nuevo en unos segundos.",
  PARTY_SIZE_NOT_ALLOWED: "El grupo supera el máximo permitido.",
  NO_SPACE: "No hay lugar ni en la cola. Amplía los cupos o la cola.",
  DUPLICATE_HANDLE: "Ya existe una solicitud activa con ese usuario de Instagram.",
  EVENT_NOT_EDITABLE: "La experiencia ya no admite cambios.",
  AT_EDGE: "Ya está en ese extremo de la cola.",
};

function unauthorized(): AdminActionState {
  return { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
}

function validationError(error: z.ZodError): AdminActionState {
  return {
    ok: false,
    message: "Revisa los campos marcados.",
    fieldErrors: fieldErrorsFromZod(error),
  };
}

function operationError(result: GuestMutationFailure): AdminActionState {
  const message =
    result.code === "PARTY_SIZE_NOT_ALLOWED"
      ? `Máximo ${result.maxPartySize} personas por solicitud.`
      : errorMessages[result.code];
  return {
    ok: false,
    message,
    fieldErrors:
      result.code === "DUPLICATE_HANDLE" && result.field ? { [result.field]: message } : undefined,
  };
}

function databaseBusy(): AdminActionState {
  return { ok: false, message: errorMessages.TRY_AGAIN };
}

async function executeMutation<T extends GuestMutationFailure | GuestMutationSuccess>(
  operation: () => Promise<T>,
): Promise<{ result: T } | { error: AdminActionState }> {
  try {
    return { result: await operation() };
  } catch (error) {
    if (retryableDatabaseErrorCode(error)) return { error: databaseBusy() };
    throw error;
  }
}

async function consumeMutationLimit(adminId: string): Promise<AdminActionState | null> {
  const result = await consume({
    scope: "admin-guest:mutation",
    subject: adminId,
    limit: 120,
    windowSeconds: 600,
  });
  return result.allowed
    ? null
    : {
        ok: false,
        message: "Alcanzaste el límite de cambios. Intenta de nuevo más tarde.",
      };
}

function statusOutcome(status: string | undefined): MessageOutcome {
  if (status === "SENT" || status === "READ" || status === "SENT_MANUALLY") return "SENT";
  if (status === "WAITING_CONTACT") return "WAITING_CONTACT";
  if (status === "WAITING_WINDOW") return "WAITING_WINDOW";
  if (status === "FAILED" || status === "DISCARDED") return "FAILED";
  return "QUEUED";
}

async function deliver(result: GuestMutationSuccess, requested: boolean): Promise<MessageOutcome> {
  if (result.messageIds.length === 0) return "NOT_SENT";
  try {
    const summary = await drainMessagesNow(result.messageIds, { timeBudgetMs: 6_000 });
    if (!requested) return "NOT_SENT";
    return statusOutcome(summary.outcomes[result.messageIds[0]!]);
  } catch {
    // The change is already committed and the messages stay in the outbox, so the
    // daily delivery picks them up. The admin only needs to know they are still queued.
    log("error", "admin_guest_immediate_delivery_failed", {
      messageCount: result.messageIds.length,
    });
    return requested ? "QUEUED" : "NOT_SENT";
  }
}

function revalidateGuestPaths(eventId: string): void {
  revalidatePath("/admin");
  revalidatePath(`/admin/events/${eventId}`);
  revalidatePath("/admin/audit");
  revalidatePath("/admin/mensajes");
}

function promotedLabels(result: GuestMutationSuccess): string[] {
  return result.promoted.map((promotion) => guestsLabel(promotion.guests));
}

async function authorize(): Promise<{ adminId: string } | { error: AdminActionState }> {
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return { error: unauthorized() };
  const rateLimit = await consumeMutationLimit(authorization.session.admin.id);
  return rateLimit ? { error: rateLimit } : { adminId: authorization.session.admin.id };
}

function parseId(id: string): AdminActionState | string {
  const parsed = adminGuestIdSchema.safeParse(id);
  return parsed.success ? parsed.data : { ok: false, message: parsed.error.issues[0]!.message };
}

export async function acceptRequestAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  void _formData;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const reservationId = parseId(id);
  if (typeof reservationId !== "string") return reservationId;
  const execution = await executeMutation(() =>
    acceptRequest(postgresGuestAdminRepository, {
      reservationId,
      actorAdminId: authorization.adminId,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  const outcome = await deliver(result, true);
  return {
    ok: true,
    message: acceptedResult({
      guests: result.guests,
      outcome,
      paymentMissing: result.paymentMissing,
    }),
  };
}

export async function verifyPaymentAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const reservationId = parseId(id);
  if (typeof reservationId !== "string") return reservationId;
  const note = paymentNoteSchema.safeParse(formData.get("paymentNote"));
  if (!note.success) return validationError(note.error);
  const execution = await executeMutation(() =>
    verifyPayment(postgresGuestAdminRepository, {
      reservationId,
      actorAdminId: authorization.adminId,
      paymentNote: note.data,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  const outcome = await deliver(result, true);
  return { ok: true, message: paymentVerifiedResult({ guests: result.guests, outcome }) };
}

export async function rejectRequestAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const reservationId = parseId(id);
  if (typeof reservationId !== "string") return reservationId;
  const replacement = reservationReplacementSchema.safeParse(readReservationReplacement(formData));
  if (!replacement.success) return validationError(replacement.error);
  const sendMessage = readSendMessage(formData);
  const execution = await executeMutation(() =>
    rejectRequest(postgresGuestAdminRepository, {
      reservationId,
      actorAdminId: authorization.adminId,
      sendMessage,
      replacement: replacement.data,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  const outcome = await deliver(result, sendMessage);
  return {
    ok: true,
    message: rejectedResult({
      guests: result.guests,
      promoted: promotedLabels(result),
      outcome,
    }),
  };
}

export async function cancelRequestAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const reservationId = parseId(id);
  if (typeof reservationId !== "string") return reservationId;
  const replacement = reservationReplacementSchema.safeParse(readReservationReplacement(formData));
  if (!replacement.success) return validationError(replacement.error);
  const expectedStage = expectedCancellationStageSchema.safeParse(formData.get("expectedStage"));
  if (!expectedStage.success) return validationError(expectedStage.error);
  const sendMessage = readSendMessage(formData);
  const execution = await executeMutation(() =>
    cancelRequest(postgresGuestAdminRepository, {
      reservationId,
      actorAdminId: authorization.adminId,
      sendMessage,
      replacement: replacement.data,
      expectedStage: expectedStage.data,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  const outcome = await deliver(result, sendMessage);
  return {
    ok: true,
    message: cancelledResult({
      guests: result.guests,
      promoted: promotedLabels(result),
      refundPending: result.refundPending,
      outcome,
    }),
  };
}

export async function markRefundedAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const reservationId = parseId(id);
  if (typeof reservationId !== "string") return reservationId;
  const sendMessage = readSendMessage(formData);
  const execution = await executeMutation(() =>
    markRefunded(postgresGuestAdminRepository, {
      reservationId,
      actorAdminId: authorization.adminId,
      sendMessage,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  const outcome = await deliver(result, sendMessage);
  return { ok: true, message: refundedResult({ guests: result.guests, outcome }) };
}

export async function updateRequestAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const reservationId = parseId(id);
  if (typeof reservationId !== "string") return reservationId;
  const fields = adminGuestFieldsSchema.safeParse(readAdminGuestFields(formData));
  if (!fields.success) return validationError(fields.error);
  const execution = await executeMutation(() =>
    updateRequest(postgresGuestAdminRepository, {
      reservationId,
      actorAdminId: authorization.adminId,
      fields: fields.data,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  await deliver(result, false);
  const entered = enteredFromQueueSentence(promotedLabels(result));
  return { ok: true, message: `Actualizaste a ${guestsLabel(result.guests)}.${entered}` };
}

export async function updateEntryAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const entryId = parseId(id);
  if (typeof entryId !== "string") return entryId;
  const fields = adminGuestFieldsSchema.safeParse(readAdminGuestFields(formData));
  if (!fields.success) return validationError(fields.error);
  const execution = await executeMutation(() =>
    updateEntry(postgresGuestAdminRepository, {
      entryId,
      actorAdminId: authorization.adminId,
      fields: fields.data,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  await deliver(result, false);
  const entered = enteredFromQueueSentence(promotedLabels(result));
  return {
    ok: true,
    message: `Actualizaste a ${guestsLabel(result.guests)} en la cola.${entered}`,
  };
}

export async function moveEntryAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const entryId = parseId(id);
  if (typeof entryId !== "string") return entryId;
  const direction = moveEntryDirectionSchema.safeParse(formData.get("direction"));
  if (!direction.success) return validationError(direction.error);
  const execution = await executeMutation(() =>
    moveEntry(postgresGuestAdminRepository, {
      entryId,
      actorAdminId: authorization.adminId,
      direction: direction.data,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  await deliver(result, false);
  const entered = enteredFromQueueSentence(promotedLabels(result));
  return { ok: true, message: `Moviste a ${guestsLabel(result.guests)} en la cola.${entered}` };
}

export async function promoteEntryAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  void _formData;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const entryId = parseId(id);
  if (typeof entryId !== "string") return entryId;
  const execution = await executeMutation(() =>
    promoteEntry(postgresGuestAdminRepository, {
      entryId,
      actorAdminId: authorization.adminId,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  const outcome = await deliver(result, true);
  return { ok: true, message: promotedFromQueueResult({ guests: result.guests, outcome }) };
}

export async function removeEntryAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const entryId = parseId(id);
  if (typeof entryId !== "string") return entryId;
  const sendMessage = readSendMessage(formData);
  const execution = await executeMutation(() =>
    removeEntry(postgresGuestAdminRepository, {
      entryId,
      actorAdminId: authorization.adminId,
      sendMessage,
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  const outcome = await deliver(result, sendMessage);
  return {
    ok: true,
    message: removedFromQueueResult({
      guests: result.guests,
      promoted: promotedLabels(result),
      outcome,
    }),
  };
}

export async function addRequestAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  void _previousState;
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  const eventId = parseId(id);
  if (typeof eventId !== "string") return eventId;
  const fields = adminGuestFieldsSchema.safeParse(readAdminGuestFields(formData));
  if (!fields.success) return validationError(fields.error);
  const execution = await executeMutation(() =>
    addRequest(postgresGuestAdminRepository, {
      eventId,
      actorAdminId: authorization.adminId,
      fields: fields.data,
      idempotencyKey: randomUUID(),
    }),
  );
  if ("error" in execution) return execution.error;
  const { result } = execution;
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  return {
    ok: true,
    message: addedResult({
      guests: result.guests,
      placement: result.placement,
      position: result.position,
    }),
  };
}
