import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import {
  MESSAGE_KINDS,
  MESSAGE_STATUSES,
  type MessageKind as DomainMessageKind,
  type MessageStatus as DomainMessageStatus,
} from "@/domain/messaging/message-types";
import type { BadgeVariant } from "@/ui/primitives/badge";

const EL_SALVADOR_TIME_ZONE = "America/El_Salvador";

export const messageStatuses = MESSAGE_STATUSES;
export type MessageStatus = DomainMessageStatus;

export const messageKinds = MESSAGE_KINDS;
export type MessageKind = DomainMessageKind;

export interface ConversationListItemView {
  contactId: string;
  title: string;
  username: string | null;
  preview: string;
  lastActivityLabel: string;
  unreadCount: number;
  linkedLabel: string | null;
  mismatch: boolean;
  href: string;
}

export interface ThreadMessageView {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  kind: MessageKind;
  status: MessageStatus;
  source: "SYSTEM" | "ADMIN" | "INSTAGRAM_APP" | "GUEST";
  body: string | null;
  imageSrcs: string[];
  createdAt: Date;
  lastError: string | null;
}

export interface ConversationHeaderView {
  contactId: string;
  title: string;
  username: string | null;
  windowOpen: boolean;
  windowClosesAt: Date | null;
  linked: Array<{
    id: string;
    kind: "RESERVATION" | "WAITLIST_ENTRY";
    label: string;
    statusLabel: string;
    href: string;
    mismatch: boolean;
  }>;
}

export type MessageAction = (
  messageId: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export type ComposerAction = (
  contactId: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export interface MessageStatusCopy {
  label: string;
  variant: BadgeVariant;
}

const statusCopy: Record<MessageStatus, MessageStatusCopy> = {
  WAITING_CONTACT: { label: "Pendiente: aún no nos escribe", variant: "waitlist" },
  WAITING_WINDOW: { label: "Pendiente: ventana cerrada", variant: "waitlist" },
  QUEUED: { label: "Enviando", variant: "draft" },
  SENT: { label: "Enviado", variant: "default" },
  READ: { label: "Leído", variant: "confirmed" },
  FAILED: { label: "No se pudo enviar", variant: "rejected" },
  SENT_MANUALLY: { label: "Enviado a mano", variant: "default" },
  DISCARDED: { label: "Descartado", variant: "inactive" },
  RECEIVED: { label: "Recibido", variant: "default" },
};

const kindLabels: Record<MessageKind, string> = {
  REQUEST_RECEIVED: "Formulario recibido",
  WAITLISTED: "En la cola",
  PROMOTED: "Entró desde la cola",
  ON_LIST: "En la lista",
  PAID: "Confirmado",
  REJECTED: "No seleccionado",
  CANCELLED_UNPAID: "Cancelación",
  CANCELLED_PAID: "Cancelación con reembolso",
  REFUNDED: "Reembolso",
  LOCATION: "Ubicación",
  CLUE: "Pista",
  FREE_TEXT: "Mensaje",
  INBOUND: "Mensaje recibido",
};

export function messageStatusCopy(status: MessageStatus): MessageStatusCopy {
  return statusCopy[status];
}

export type DeliveryIcon = "clock" | "check" | "check-check" | "alert" | "ban";

export interface DeliveryIndicator {
  icon: DeliveryIcon;
  label: string;
  failed: boolean;
}

const deliveryIndicators: Record<MessageStatus, DeliveryIndicator> = {
  WAITING_CONTACT: { icon: "clock", label: "En espera: aún no nos escribe", failed: false },
  WAITING_WINDOW: { icon: "clock", label: "En espera: ventana cerrada", failed: false },
  QUEUED: { icon: "clock", label: "En espera", failed: false },
  SENT: { icon: "check", label: "Enviado", failed: false },
  SENT_MANUALLY: { icon: "check", label: "Enviado a mano", failed: false },
  READ: { icon: "check-check", label: "Leído", failed: false },
  FAILED: { icon: "alert", label: "No se pudo", failed: true },
  DISCARDED: { icon: "ban", label: "Descartado", failed: false },
  RECEIVED: { icon: "check", label: "Recibido", failed: false },
};

export function messageDeliveryIndicator(status: MessageStatus): DeliveryIndicator {
  return deliveryIndicators[status];
}

export function messageKindLabel(kind: MessageKind): string {
  return kindLabels[kind];
}

export function windowCopy({ open, closesAt }: { open: boolean; closesAt: Date | null }): string {
  if (!open) {
    return "La ventana de 24 horas está cerrada: lo que envíes saldrá cuando la persona vuelva a escribir. También puedes copiarlo y enviarlo desde Instagram.";
  }
  if (closesAt === null) {
    throw new Error("An open reply window needs the time it closes.");
  }

  const closesInElSalvador = TZDate.tz(EL_SALVADOR_TIME_ZONE, closesAt);
  const time = format(closesInElSalvador, "HH:mm");
  const day = format(closesInElSalvador, "d 'de' MMMM", { locale: es });
  return `Puedes escribirle hasta las ${time} del ${day}`;
}

export function instagramChatHref(username: string): string {
  return `https://ig.me/m/${encodeURIComponent(username)}`;
}

export function instagramProfileHref(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}
