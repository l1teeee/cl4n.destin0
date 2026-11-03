import type {
  MessagingHealth,
  UnsentMessage,
  UnsentMessageStatus,
} from "@/application/messaging/messaging-health";
import { formatAdminDate } from "@/ui/admin/view-model";
import type { BadgeVariant } from "@/ui/primitives/badge";

import { messageKindLabel, messageStatusCopy, type MessageStatusCopy } from "./message-copy";

export interface MessagingHealthView {
  failing: boolean;
  title: string | null;
  detail: string | null;
  lastSignalLabel: string | null;
}

export interface UnsentMessageView {
  id: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  kindLabel: string;
  guestLabel: string;
  eventLabel: string | null;
  username: string | null;
  body: string | null;
  attachmentNote: string | null;
  errorLabel: string | null;
  createdLabel: string;
  conversationHref: string | null;
  canDiscard: boolean;
}

function healthTitle(health: MessagingHealth): string | null {
  if (!health.failing) return null;
  if (health.connection === "MISSING") {
    return "Instagram no está conectado: los mensajes no salen solos.";
  }
  if (health.connection === "EXPIRED") {
    return "La conexión con Instagram venció: los mensajes no salen solos.";
  }
  const count = health.failedCount + health.retryingCount;
  return count === 1
    ? "1 mensaje no salió por Instagram."
    : `${count} mensajes no salieron por Instagram.`;
}

function lastSignalCopy(health: MessagingHealth): string | null {
  if (health.connection === "NOT_USED") return null;
  if (health.lastMetaSignalAt === null) return "Todavía no llega ningún aviso de Instagram.";
  return `Último aviso de Instagram: ${formatAdminDate(health.lastMetaSignalAt)}`;
}

export function messagingHealthView(health: MessagingHealth): MessagingHealthView {
  return {
    failing: health.failing,
    title: healthTitle(health),
    detail: health.failing ? "Mientras se resuelve, envíalos a mano desde Instagram." : null,
    lastSignalLabel: lastSignalCopy(health),
  };
}

function unsentStatusCopy(status: UnsentMessageStatus): MessageStatusCopy {
  if (status === "RETRYING") return { label: "Reintentando", variant: "draft" };
  return messageStatusCopy(status);
}

function attachmentCopy(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) return "Incluye 1 foto: envíala desde Instagram.";
  return `Incluye ${count} fotos: envíalas desde Instagram.`;
}

export function unsentMessageView(message: UnsentMessage): UnsentMessageView {
  const status = unsentStatusCopy(message.status);
  const eventLabel =
    message.eventName && message.eventStartsAt
      ? `${message.eventName} · ${formatAdminDate(message.eventStartsAt)}`
      : null;

  return {
    id: message.id,
    statusLabel: status.label,
    statusVariant: status.variant,
    kindLabel: messageKindLabel(message.kind),
    guestLabel: message.guestName ?? "Sin solicitud vinculada",
    eventLabel,
    username: message.instagramUsername,
    body: message.body,
    attachmentNote: attachmentCopy(message.attachmentCount),
    errorLabel: message.status === "FAILED" ? message.lastError : null,
    createdLabel: formatAdminDate(message.createdAt),
    conversationHref: message.contactId ? `/admin/mensajes?c=${message.contactId}` : null,
    canDiscard: message.status !== "FAILED",
  };
}
