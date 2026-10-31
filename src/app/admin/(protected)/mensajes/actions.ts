"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import {
  discardMessage as discardMessageUseCase,
  linkContact as linkContactUseCase,
  markConversationRead as markConversationReadUseCase,
  markSentManually as markSentManuallyUseCase,
  retryMessage as retryMessageUseCase,
  sendFreeText as sendFreeTextUseCase,
  unlinkContact as unlinkContactUseCase,
} from "@/application/messaging/admin-message-use-cases";
import type { MessageSubject } from "@/application/messaging/admin-message-repository";
import { isLinkCode } from "@/domain/messaging/link-code";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { env } from "@/infrastructure/config/env";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import type { InstagramWebhookEvent } from "@/application/messaging/instagram-events";
import { drainMessagesNow } from "@/infrastructure/messaging/drain-message-outbox";
import { ingestConfiguredInstagramEvents } from "@/infrastructure/messaging/ingest-instagram-events";
import { consume } from "@/infrastructure/rate-limit/postgres-rate-limiter";

const idSchema = z.uuid("El identificador no es válido.");
const simulatorSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._]{1,30}$/, "El usuario no es válido."),
  text: z.string().trim().min(1, "Escribe un mensaje.").max(2000, "El mensaje es demasiado largo."),
  linkCode: z.string().trim().toUpperCase().optional(),
});

function unauthorized(): AdminActionState {
  return { ok: false, message: "Tu sesión no es válida. Inicia sesión nuevamente." };
}

function deliveryMessage(status: string, lastError: string | null): AdminActionState {
  if (status === "SENT") return { ok: true, message: "Mensaje enviado." };
  if (status === "WAITING_WINDOW") {
    return {
      ok: true,
      message:
        "La ventana de 24 horas está cerrada: el mensaje se enviará cuando la persona escriba.",
    };
  }
  if (status === "QUEUED") {
    return { ok: false, message: "No se pudo enviar ahora: se reintentará automáticamente." };
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
  revalidatePath("/admin");
}

export async function sendFreeTextAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return unauthorized();
  const contactId = idSchema.safeParse(id);
  if (!contactId.success) return { ok: false, message: contactId.error.issues[0]!.message };

  const result = await sendFreeTextUseCase(
    {
      repository: postgresMessageRepository,
      consumeRateLimit: (adminId) =>
        consume({
          scope: "admin-message:send",
          subject: adminId,
          limit: 60,
          windowSeconds: 600,
        }),
      deliver: (messageIds) => drainMessagesNow(messageIds, { timeBudgetMs: 6_000 }),
    },
    contactId.data,
    String(formData.get("text") ?? ""),
    authorization.session.admin.id,
  );
  if (!result.ok) {
    const messages = {
      INVALID_TEXT: "El mensaje debe tener entre 1 y 1000 caracteres.",
      CONTACT_NOT_FOUND: "No se encontró la conversación.",
      RATE_LIMITED: "Alcanzaste el límite de mensajes. Intenta de nuevo más tarde.",
    } as const;
    return { ok: false, message: messages[result.error] };
  }
  refreshMessages();
  return deliveryMessage(result.status, result.lastError);
}

export async function retryMessageAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  if (!(await retryMessageUseCase(postgresMessageRepository, parsed.data))) {
    return { ok: false, message: "Este mensaje no se puede reintentar." };
  }
  const summary = await drainMessagesNow([parsed.data], { timeBudgetMs: 6_000 });
  const state = await postgresMessageRepository.getDeliveryState(parsed.data);
  refreshMessages();
  return deliveryMessage(
    summary.outcomes[parsed.data] ?? state?.status ?? "QUEUED",
    state?.lastError ?? null,
  );
}

export async function markSentManuallyAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const updated = await markSentManuallyUseCase(
    postgresMessageRepository,
    parsed.data,
    authorization.session.admin.id,
  );
  if (!updated) return { ok: false, message: "Este mensaje no se puede marcar como enviado." };
  refreshMessages();
  return { ok: true, message: "Mensaje marcado como enviado manualmente." };
}

export async function discardMessageAction(
  id: string,
  _previousState: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  void _formData;
  if (!authorization.authorized) return unauthorized();
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };
  const updated = await discardMessageUseCase(
    postgresMessageRepository,
    parsed.data,
    authorization.session.admin.id,
  );
  if (!updated) return { ok: false, message: "Este mensaje no se puede descartar." };
  refreshMessages();
  return { ok: true, message: "Mensaje descartado." };
}

export async function linkContactAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return unauthorized();
  const contactId = idSchema.safeParse(id);
  const subject = subjectFrom(formData);
  if (!contactId.success || !subject) return { ok: false, message: "La vinculación no es válida." };
  const linked = await linkContactUseCase(
    postgresMessageRepository,
    contactId.data,
    subject,
    authorization.session.admin.id,
  );
  if (!linked) return { ok: false, message: "No se pudo vincular la solicitud." };
  refreshMessages();
  return { ok: true, message: "Conversación vinculada." };
}

export async function unlinkContactAction(
  id: string,
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const authorization = await requireAdmin("action");
  void _previousState;
  if (!authorization.authorized) return unauthorized();
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
  if (!unlinked) return { ok: false, message: "No se pudo desvincular la solicitud." };
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
  const authorization = await requireAdmin("action");
  if (!authorization.authorized) return unauthorized();
  if (env.MESSAGING_MODE !== "log" || !["local", "test"].includes(env.APP_ENV)) {
    return { ok: false, message: "El simulador solo está disponible en modo local." };
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
    events.push({ type: "referral", senderId, ref: parsed.data.linkCode, timestamp });
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
    knownUsernames: { [senderId]: parsed.data.username },
  });
  after(() => result.after());
  refreshMessages();
  return { ok: true, message: "Mensaje simulado recibido." };
}
