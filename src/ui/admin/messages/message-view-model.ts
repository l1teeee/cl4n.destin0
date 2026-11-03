import { TZDate } from "@date-fns/tz";
import { differenceInCalendarDays, format } from "date-fns";
import { es } from "date-fns/locale";

import type {
  ConversationDetail,
  ConversationMessage,
  ConversationSummary,
  LinkedRequestSummary,
} from "@/application/messaging/conversation-queries";
import type { RenderedTemplate } from "@/application/messaging/manual-templates";
import { isMessagingWindowOpen } from "@/domain/messaging/messaging-window";

import {
  conversationPreviewText,
  type ComposerTemplates,
  type ConversationHeaderView,
  type ConversationListItemView,
  type ThreadMessageView,
} from "./message-copy";
import { TEMPLATE_COPY } from "./template-copy";

const TIME_ZONE = "America/El_Salvador";
const WINDOW_MS = (24 * 60 - 5) * 60 * 1000;

export interface ConversationFilters {
  search: string;
  unlinkedOnly: boolean;
  page: number;
}

export function shouldShowMessagingSimulator(mode: string, appEnvironment: string): boolean {
  return mode === "log" && (appEnvironment === "local" || appEnvironment === "test");
}

function local(date: Date): TZDate {
  return TZDate.tz(TIME_ZONE, date);
}

function normalizedHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

export function requestUsernameMismatch(
  username: string | null,
  request: LinkedRequestSummary,
): boolean {
  if (!username) return false;
  const contactHandle = normalizedHandle(username);
  return !request.instagramHandles.some((handle) => normalizedHandle(handle) === contactHandle);
}

export function conversationTimeLabel(date: Date, now: Date): string {
  const localDate = local(date);
  const days = differenceInCalendarDays(local(now), localDate);
  if (days === 0) return format(localDate, "HH:mm");
  if (days === 1) return "ayer";
  if (days > 1 && days < 7) return format(localDate, "EEE", { locale: es }).replace(".", "");
  return format(localDate, "d MMM", { locale: es }).replace(".", "");
}

export function requestDateLabel(date: Date): string {
  return format(local(date), "EEE d MMM", { locale: es }).replaceAll(".", "");
}

export function conversationHref(contactId: string | null, filters: ConversationFilters): string {
  const params = new URLSearchParams();
  if (contactId) params.set("c", contactId);
  if (filters.search) params.set("q", filters.search);
  if (filters.unlinkedOnly) params.set("sinVincular", "1");
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/admin/mensajes?${query}` : "/admin/mensajes";
}

function requestListLabel(request: LinkedRequestSummary): string {
  return `${request.guests.join(" y ")} · ${requestDateLabel(request.eventStartsAt)}`;
}

export function conversationListItemView(
  conversation: ConversationSummary,
  filters: ConversationFilters,
  now: Date,
): ConversationListItemView {
  const primaryRequest = conversation.linkedRequests[0];
  const mismatch = conversation.linkedRequests.some((request) =>
    requestUsernameMismatch(conversation.username, request),
  );
  return {
    contactId: conversation.contactId,
    title:
      conversation.displayName ??
      (conversation.username ? `@${conversation.username}` : "Contacto de Instagram"),
    username: conversation.username,
    preview: conversationPreviewText(conversation.lastMessagePreview),
    lastActivityLabel: conversationTimeLabel(conversation.lastActivityAt, now),
    unreadCount: conversation.unreadCount,
    linkedLabel: primaryRequest ? requestListLabel(primaryRequest) : null,
    mismatch,
    href: conversationHref(conversation.contactId, filters),
  };
}

function requestStatusLabel(request: LinkedRequestSummary): string {
  if (request.type === "WAITLIST_ENTRY") {
    return request.status === "WAITING" ? "En cola" : "Fuera de la cola";
  }
  if (request.status === "CANCELLED") return "Cancelada";
  const stages: Record<string, string> = {
    IN_REVIEW: "Por revisar",
    ON_LIST: "En la lista",
    PAID: "Confirmado",
  };
  return request.stage ? (stages[request.stage] ?? request.stage) : request.status;
}

export function conversationHeaderView(
  conversation: ConversationDetail,
  now: Date,
): ConversationHeaderView {
  const lastInboundAt = conversation.contact.lastInboundAt;
  const windowOpen = isMessagingWindowOpen(lastInboundAt, now);
  return {
    contactId: conversation.contact.id,
    title:
      conversation.contact.displayName ??
      (conversation.contact.username
        ? `@${conversation.contact.username}`
        : "Contacto de Instagram"),
    username: conversation.contact.username,
    windowOpen,
    windowClosesAt:
      windowOpen && lastInboundAt ? new Date(lastInboundAt.getTime() + WINDOW_MS) : null,
    linked: conversation.linkedRequests.map((request) => ({
      id: request.id,
      kind: request.type,
      label: requestListLabel(request),
      statusLabel: requestStatusLabel(request),
      href: `/admin/events/${request.eventId}?seccion=reservaciones`,
      mismatch: requestUsernameMismatch(conversation.contact.username, request),
    })),
  };
}

export function hasUnreadMessages(conversation: ConversationDetail): boolean {
  const readAt = conversation.contact.adminReadAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  return conversation.messages.some(
    (message) => message.direction === "INBOUND" && message.createdAt.getTime() > readAt,
  );
}

export function threadMessageView(message: ConversationMessage): ThreadMessageView {
  return {
    id: message.id,
    direction: message.direction,
    kind: message.kind,
    status: message.status,
    source: message.source,
    body: message.body,
    imageSrcs:
      message.direction === "INBOUND"
        ? message.attachmentIds.map((id) => `/admin/mensajes/adjuntos/${id}`)
        : message.attachmentUrls,
    createdAt: message.createdAt,
    lastError: message.lastError,
  };
}

export function composerTemplatesView(
  header: ConversationHeaderView,
  rendered: readonly RenderedTemplate[] | null,
): ComposerTemplates | null {
  const source = header.linked[0];
  if (!source || rendered === null) return null;
  return {
    sourceLabel: source.label,
    options: rendered.map((template) => ({
      key: template.key,
      title: TEMPLATE_COPY[template.key].title,
      text: template.text,
    })),
  };
}
