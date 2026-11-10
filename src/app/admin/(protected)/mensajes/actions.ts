"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import {
  deleteConversation as deleteConversationUseCase,
  discardMessage as discardMessageUseCase,
  linkContact as linkContactUseCase,
  linkContactByCode as linkContactByCodeUseCase,
  markConversationRead as markConversationReadUseCase,
  markSentManually as markSentManuallyUseCase,
  recordManualMessage as recordManualMessageUseCase,
  retryMessage as retryMessageUseCase,
  sendFreeText as sendFreeTextUseCase,
  unlinkContact as unlinkContactUseCase,
} from "@/application/messaging/admin-message-use-cases";
import type { MessageSubject } from "@/application/messaging/admin-message-repository";
import { isLinkCode } from "@/domain/messaging/link-code";
import { requireAdmin, requirePermission } from "@/infrastructure/auth/require-admin";
import { env } from "@/infrastructure/config/env";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";
import { drainMessagesNow } from "@/infrastructure/messaging/drain-message-outbox";
import { ingestConfiguredInstagramEvents } from "@/infrastructure/messaging/ingest-instagram-events";
import { scheduleMessageDelivery } from "@/infrastructure/messaging/schedule-message-delivery";
import { consumeAdminMessageRateLimit } from "@/infrastructure/rate-limit/admin-message-rate-limit";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";

const idSchema = z.uuid("El identificador no es válido.");
const FREE_TEXT_ERRORS = {
  INVALID_TEXT: "El mensaje debe tener entre 1 y 1000 caracteres.",
  CONTACT_NOT_FOUND: "No se encontró la conversación.",
  RATE_LIMITED: "Alcanzaste el límite de mensajes. Intenta de nuevo más tarde.",
} as const;
const simulatorSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._]{1,30}$/, "El usuario no es válido."),
  text: z.string().trim().min(1, "Escribe un mensaje.").max(2000, "El mensaje es demasiado largo."),
  linkCode: z.string().trim().toUpperCase().optional(),
});

function unauthorized(error: "UNAUTHORIZED" | "FORBIDDEN" = "UNAUTHORIZED"): AdminActionState {
  return {
    ok: false,
    message:
      error === "FORBIDDEN"
        ? "Solo un superadministrador puede enviar o cambiar mensajes."
        : "Tu sesión no es válida. Inicia sesión nuevamente.",
  };
}

async function deliveryMessage(
  messageId: string,
  status: string,
  lastError: string | null,
): Promise<AdminActionState> {
  if (status === "SENT") return { ok: true, message: "Mensaje enviado." };
  if (status === "WAITING_WINDOW") {
    return {
      ok: true,
      message:
        "La ventana de 24 horas está cerrada: el mensaje se enviará cuando la persona escriba.",
    };
  }
  if (status === "QUEUED") {
    scheduleMessageDelivery();
    if (await postgresMessageRepository.isBlockedByWaitingWindow(messageId)) {
      return {
        ok: true,
        message:
          "Hay mensajes anteriores esperando que la persona escriba; este saldrá después de ellos.",
      };
    }
    return {
      ok: false,
      message: "No se pudo enviar ahora: se reintentará automáticamente.",
    };
  }
  return { ok: false, message: `No se pudo enviar: ${lastError ?? status}.` };
}

function subjectFrom(formData: FormData): MessageSubject | null {
  const reservationId = idSchema.safeParse(formData.get("reservationId"));
  const waitlistEntryId = idSchema.safeParse(formData.get("waitlistEntryId"));
  if (reservationId.success && !waitlistEntryId.success) {
    return { reservationId: reservationId.data };
  }
  if (waitlistEntryId.success && !reservationId.success) {
    return { waitlistEntryId: waitlistEntryId.data };
  }
  return null;
}

function refreshMessages(): void {
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin/mensajes/sin-enviar");
  revalidatePath("/admin");
}

export async function sendFreeTextAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const contactId = idSchema.safeParse(id);
  if (!contactId.success) return { ok: false, message: contactId.error.issues[0]!.message };

  const result = await sendFreeTextUseCase(
    {
      repository: postgresMessageRepository,
      consumeRateLimit: consumeAdminMessageRateLimit,
      deliver: (messageIds) => drainMessagesNow(messageIds, { timeBudgetMs: 6_000 }),
    },
    contactId.data,
    String(formData.get("text") ?? ""),
    authorization.session.admin.id,
  );
  if (!result.ok) return { ok: false, message: FREE_TEXT_ERRORS[result.error] };
  refreshMessages();
  return deliveryMessage(result.messageId, result.status, result.lastError);
}

export async function recordManualMessageAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const contactId = idSchema.safeParse(id);
  if (!contactId.success) return { ok: false, message: contactId.error.issues[0]!.message };

  const result = await recordManualMessageUseCase(
    { repository: postgresMessageRepository, consumeRateLimit: consumeAdminMessageRateLimit },
    contactId.data,
    String(formData.get("text") ?? ""),
    authorization.session.admin.id,
  );
  if (!result.ok) return { ok: false, message: FREE_TEXT_ERRORS[result.error] };
  refreshMessages();
  return { ok: true, message: "Guardado como enviado a mano." };
}

export async function retryMessageAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const retried = await retryMessageUseCase(postgresMessageRepository, parsed.data);
  if (retried === "LIVE_LEASE") {
    return {
      ok: false,
      message: "El mensaje se está enviando en este momento. Intenta de nuevo en unos segundos.",
    };
  }
  if (retried !== "UPDATED") {
    return { ok: false, message: "Este mensaje no se puede reintentar." };
  }
  const summary = await drainMessagesNow([parsed.data], {
    timeBudgetMs: 6_000,
  });
  const state = await postgresMessageRepository.getDeliveryState(parsed.data);
  refreshMessages();
  return deliveryMessage(
    parsed.data,
    summary.outcomes[parsed.data] ?? state?.status ?? "QUEUED",
    state?.lastError ?? null,
  );
}

export async function markSentManuallyAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const updated = await markSentManuallyUseCase(
    postgresMessageRepository,
    parsed.data,
    authorization.session.admin.id,
  );
  if (updated === "LIVE_LEASE") {
    return {
      ok: false,
      message: "El mensaje se está enviando en este momento. Intenta de nuevo en unos segundos.",
    };
  }
  if (updated !== "UPDATED") {
    return {
      ok: false,
      message: "Este mensaje no se puede marcar como enviado.",
    };
  }
  refreshMessages();
  return { ok: true, message: "Mensaje marcado como enviado manualmente." };
}

export async function discardMessageAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const updated = await discardMessageUseCase(
    postgresMessageRepository,
    parsed.data,
    authorization.session.admin.id,
  );
  if (updated === "LIVE_LEASE") {
    return {
      ok: false,
      message: "El mensaje se está enviando en este momento. Intenta de nuevo en unos segundos.",
    };
  }
  if (updated !== "UPDATED") {
    return { ok: false, message: "Este mensaje no se puede descartar." };
  }
  refreshMessages();
  return { ok: true, message: "Mensaje descartado." };
}

export async function linkContactAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const contactId = idSchema.safeParse(id);
  const subject = subjectFrom(formData);
  if (!contactId.success || !subject) return { ok: false, message: "La vinculación no es válida." };
  const rateLimit = await consume({
    scope: "admin-message:link",
    subject: authorization.session.admin.id,
    limit: 60,
    windowSeconds: 600,
  });
  if (!rateLimit.allowed) {
    return {
      ok: false,
      message: "Alcanzaste el límite de vinculaciones. Intenta más tarde.",
    };
  }
  const linked = await linkContactUseCase(
    postgresMessageRepository,
    contactId.data,
    subject,
    authorization.session.admin.id,
  );
  if (!linked) return { ok: false, message: "No se pudo vincular la solicitud." };
  // Linking turns the request's waiting messages into QUEUED rows; without a drain they wait for the daily cron.
  scheduleMessageDelivery();
  refreshMessages();
  return { ok: true, message: "Conversación vinculada." };
}

export async function linkContactByCodeAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const contactId = idSchema.safeParse(id);
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase();
  if (!contactId.success || !isLinkCode(code)) {
    return { ok: false, message: "El código de vinculación no es válido." };
  }
  const rateLimit = await consume({
    scope: "admin-message:link",
    subject: authorization.session.admin.id,
    limit: 60,
    windowSeconds: 600,
  });
  if (!rateLimit.allowed) {
    return {
      ok: false,
      message: "Alcanzaste el límite de vinculaciones. Intenta más tarde.",
    };
  }
  const linked = await linkContactByCodeUseCase(
    postgresMessageRepository,
    contactId.data,
    code,
    authorization.session.admin.id,
  );
  if (linked === 0) {
    return {
      ok: false,
      message: "Ese código no corresponde a ninguna solicitud.",
    };
  }
  scheduleMessageDelivery();
  refreshMessages();
  return { ok: true, message: "Conversación vinculada." };
}

export async function deleteConversationAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const contactId = idSchema.safeParse(id);
  if (!contactId.success) return { ok: false, message: "La conversación no es válida." };
  const rateLimit = await consume({
    scope: "admin-message:delete",
    subject: authorization.session.admin.id,
    limit: 30,
    windowSeconds: 600,
  });
  if (!rateLimit.allowed) {
    return {
      ok: false,
      message: "Alcanzaste el límite de eliminaciones. Intenta más tarde.",
    };
  }
  const result = await deleteConversationUseCase(
    postgresMessageRepository,
    contactId.data,
    authorization.session.admin.id,
  );
  if (result !== "DELETED") {
    const messages = {
      NOT_FOUND: "No se encontró la conversación.",
      LINKED: "Esta conversación está vinculada a una solicitud. Desvincúlala antes de eliminarla.",
      HAS_REQUEST_MESSAGES:
        "Esta conversación tiene mensajes de una solicitud y no se puede eliminar.",
      LIVE_LEASE: "Un mensaje se está enviando en este momento. Intenta de nuevo en unos segundos.",
    };
    return { ok: false, message: messages[result] };
  }
  refreshMessages();
  redirect("/admin/mensajes");
}

export async function unlinkContactAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  void _previousState;
  if (!authorization.authorized) return unauthorized(authorization.error);
  const contactId = idSchema.safeParse(id);
  const subject = subjectFrom(formData);
  if (!contactId.success || !subject)
    return { ok: false, message: "La desvinculación no es válida." };
  const unlinked = await unlinkContactUseCase(
    postgresMessageRepository,
    contactId.data,
    subject,
    authorization.session.admin.id,
  );
  if (unlinked === "LIVE_LEASE") {
    return {
      ok: false,
      message: "El mensaje se está enviando en este momento. Intenta de nuevo en unos segundos.",
    };
  }
  if (unlinked !== "UPDATED") {
    return { ok: false, message: "No se pudo desvincular la solicitud." };
  }
  refreshMessages();
  return { ok: true, message: "Conversación desvinculada." };
}

export async function markConversationReadAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const contactId = idSchema.safeParse(id);
  if (!contactId.success) return { ok: false, message: contactId.error.issues[0]!.message };
  const updated = await markConversationReadUseCase(postgresMessageRepository, contactId.data);
  if (!updated) return { ok: false, message: "No se encontró la conversación." };
  refreshMessages();
  return { ok: true, message: "Conversación marcada como leída." };
}

function simulatorScopedId(username: string): string {
  const hex = createHash("sha256").update(username).digest("hex").slice(0, 15);
  return BigInt(`0x${hex}`).toString();
}

export async function simulateInboundMessageAction(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requirePermission("messages.send", "action");
  if (!authorization.authorized) return unauthorized(authorization.error);
  if (env.MESSAGING_MODE !== "log" || !["local", "test"].includes(env.APP_ENV)) {
    return {
      ok: false,
      message: "El simulador solo está disponible en modo local.",
    };
  }
  const parsed = simulatorSchema.safeParse({
    username: formData.get("username"),
    text: formData.get("text"),
    linkCode: formData.get("linkCode") || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  if (parsed.data.linkCode && !isLinkCode(parsed.data.linkCode)) {
    return { ok: false, message: "El código de vinculación no es válido." };
  }

  const senderId = simulatorScopedId(parsed.data.username);
  const timestamp = new Date();
  const events: InstagramWebhookEvent[] = [];
  if (parsed.data.linkCode) {
    events.push({
      type: "referral",
      senderId,
      ref: parsed.data.linkCode,
      timestamp,
    });
  }
  events.push({
    type: "inbound_message",
    externalMessageId: `sim-${randomUUID()}`,
    senderId,
    timestamp,
    text: parsed.data.text,
    attachmentUrls: [],
    imageAttachmentUrls: [],
    quickReplyPayload: null,
    referralRef: null,
  });
  const result = await ingestConfiguredInstagramEvents(events, {
    ownAccountId: null,
    knownUsernames: { [senderId]: parsed.data.username },
  });
  after(() => result.after());
  refreshMessages();
  return { ok: true, message: "Mensaje simulado recibido." };
}
