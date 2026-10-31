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
  expectedPromotedEntryIdsSchema,
  moveEntryDirectionSchema,
  paymentNoteSchema,
  readAdminGuestFields,
  readSendMessage,
} from "@/contracts/admin-guest";
import { generateLinkCode } from "@/infrastructure/crypto/link-code-generator";
import { postgresGuestAdminRepository } from "@/infrastructure/db/repositories/postgres-guest-admin-repository";
import { drainMessagesNow } from "@/infrastructure/messaging/drain-message-outbox";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";
import {
  acceptedResult,
  addedResult,
  cancelledResult,
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
  NO_SEAT: "No hay un lugar libre para eso.",
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
  const message = errorMessages[result.code];
  return {
    ok: false,
    message,
    fieldErrors:
      result.code === "DUPLICATE_HANDLE"
        ? { [result.field ?? "guest1Instagram"]: message }
        : undefined,
  };
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
  const summary = await drainMessagesNow(result.messageIds, { timeBudgetMs: 6_000 });
  if (!requested) return "NOT_SENT";
  return statusOutcome(summary.outcomes[result.messageIds[0]!]);
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
  const result = await acceptRequest(postgresGuestAdminRepository, {
    reservationId,
    actorAdminId: authorization.adminId,
  });
  if (!result.ok) return operationError(result);
  const outcome = await deliver(result, true);
  revalidateGuestPaths(result.eventId);
  return { ok: true, message: acceptedResult({ guests: result.guests, outcome }) };
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
  const result = await verifyPayment(postgresGuestAdminRepository, {
    reservationId,
    actorAdminId: authorization.adminId,
    paymentNote: note.data,
  });
  if (!result.ok) return operationError(result);
  const outcome = await deliver(result, true);
  revalidateGuestPaths(result.eventId);
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
  const expected = expectedPromotedEntryIdsSchema.safeParse(
    formData.getAll("expectedPromotedEntryIds"),
  );
  if (!expected.success) return validationError(expected.error);
  const sendMessage = readSendMessage(formData);
  const result = await rejectRequest(postgresGuestAdminRepository, {
    reservationId,
    actorAdminId: authorization.adminId,
    sendMessage,
    expectedPromotedEntryIds: expected.data,
  });
  if (!result.ok) return operationError(result);
  const outcome = await deliver(result, sendMessage);
  revalidateGuestPaths(result.eventId);
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
  const expected = expectedPromotedEntryIdsSchema.safeParse(
    formData.getAll("expectedPromotedEntryIds"),
  );
  if (!expected.success) return validationError(expected.error);
  const sendMessage = readSendMessage(formData);
  const result = await cancelRequest(postgresGuestAdminRepository, {
    reservationId,
    actorAdminId: authorization.adminId,
    sendMessage,
    expectedPromotedEntryIds: expected.data,
  });
  if (!result.ok) return operationError(result);
  const outcome = await deliver(result, sendMessage);
  revalidateGuestPaths(result.eventId);
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
  const result = await markRefunded(postgresGuestAdminRepository, {
    reservationId,
    actorAdminId: authorization.adminId,
    sendMessage,
  });
  if (!result.ok) return operationError(result);
  const outcome = await deliver(result, sendMessage);
  revalidateGuestPaths(result.eventId);
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
  const result = await updateRequest(postgresGuestAdminRepository, {
    reservationId,
    actorAdminId: authorization.adminId,
    fields: fields.data,
  });
  if (!result.ok) return operationError(result);
  await deliver(result, false);
  revalidateGuestPaths(result.eventId);
  const promoted = promotedLabels(result);
  const promotion = promoted.length > 0 ? ` Entró ${promoted.join(" y ")} desde la cola.` : "";
  return { ok: true, message: `Actualizaste a ${guestsLabel(result.guests)}.${promotion}` };
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
  const result = await updateEntry(postgresGuestAdminRepository, {
    entryId,
    actorAdminId: authorization.adminId,
    fields: fields.data,
  });
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  return { ok: true, message: `Actualizaste a ${guestsLabel(result.guests)} en la cola.` };
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
  const result = await moveEntry(postgresGuestAdminRepository, {
    entryId,
    actorAdminId: authorization.adminId,
    direction: direction.data,
  });
  if (!result.ok) return operationError(result);
  revalidateGuestPaths(result.eventId);
  return { ok: true, message: `Moviste a ${guestsLabel(result.guests)} en la cola.` };
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
  const result = await promoteEntry(postgresGuestAdminRepository, {
    entryId,
    actorAdminId: authorization.adminId,
  });
  if (!result.ok) return operationError(result);
  const outcome = await deliver(result, true);
  revalidateGuestPaths(result.eventId);
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
  const result = await removeEntry(postgresGuestAdminRepository, {
    entryId,
    actorAdminId: authorization.adminId,
    sendMessage,
  });
  if (!result.ok) return operationError(result);
  const outcome = await deliver(result, sendMessage);
  revalidateGuestPaths(result.eventId);
  return { ok: true, message: removedFromQueueResult({ guests: result.guests, outcome }) };
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
  const result = await addRequest(postgresGuestAdminRepository, {
    eventId,
    actorAdminId: authorization.adminId,
    fields: fields.data,
    linkCode: generateLinkCode(),
    idempotencyKey: randomUUID(),
  });
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
