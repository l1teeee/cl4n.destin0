import Link from "next/link";
import { z } from "zod";

import {
  discardMessageAction,
  linkContactByCodeAction,
  markConversationReadAction,
  markSentManuallyAction,
  recordManualMessageAction,
  retryMessageAction,
  sendFreeTextAction,
  simulateInboundMessageAction,
  unlinkContactAction,
} from "@/app/admin/(protected)/mensajes/actions";
import { getConversation, listConversations } from "@/application/messaging/conversation-queries";
import { renderTemplatesForRequest } from "@/application/messaging/manual-templates";
import { hasPermission } from "@/domain/admin/admin-access";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { env } from "@/infrastructure/config/env";
import { postgresMessageRepository } from "@/infrastructure/db/repositories/postgres-message-repository";
import { postgresMessageTemplateRepository } from "@/infrastructure/db/repositories/postgres-message-template-repository";
import { loadMessagingHealth } from "@/infrastructure/messaging/load-messaging-health";
import { ConversationAutoRefresh } from "@/ui/admin/messages/conversation-auto-refresh";
import { ConversationControls } from "@/ui/admin/messages/conversation-controls";
import { ConversationHeader } from "@/ui/admin/messages/conversation-header";
import { ConversationList } from "@/ui/admin/messages/conversation-list";
import { MarkConversationRead } from "@/ui/admin/messages/mark-conversation-read";
import { MessageComposer } from "@/ui/admin/messages/message-composer";
import { MessageSimulatorPanel } from "@/ui/admin/messages/message-simulator-panel";
import { MessageThread } from "@/ui/admin/messages/message-thread";
import { MessagesLayout } from "@/ui/admin/messages/messages-layout";
import { MessagingHealthBanner } from "@/ui/admin/messages/messaging-health-banner";
import { messagingHealthView } from "@/ui/admin/messages/messaging-health-view";
import { RefreshButton } from "@/ui/admin/messages/refresh-button";
import {
  composerTemplatesView,
  conversationHeaderView,
  conversationHref,
  conversationListItemView,
  hasUnreadMessages,
  threadMessageView,
  type ConversationFilters,
} from "@/ui/admin/messages/message-view-model";
import { Button } from "@/ui/primitives/button";

import { deleteConversationAction } from "./actions";

const PAGE_SIZE = 30;

interface MessagesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number(first(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function contactId(value: string | string[] | undefined): string | null {
  const parsed = z.uuid().safeParse(first(value));
  return parsed.success ? parsed.data : null;
}

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  const authorization = await requireAdmin("page");
  const canSend = hasPermission(authorization.session.admin.role, "messages.send");
  const query = await searchParams;
  const selectedContactId = contactId(query.c);
  const filters: ConversationFilters = {
    search: first(query.q).trim(),
    unlinkedOnly: first(query.sinVincular) === "1",
    page: pageNumber(query.page),
  };
  const now = new Date();
  const [result, selectedConversation, health] = await Promise.all([
    listConversations(postgresMessageRepository, {
      search: filters.search || undefined,
      unlinkedOnly: filters.unlinkedOnly,
      page: filters.page,
      pageSize: PAGE_SIZE,
    }),
    selectedContactId
      ? getConversation(postgresMessageRepository, selectedContactId)
      : Promise.resolve(null),
    loadMessagingHealth(),
  ]);
  const healthView = messagingHealthView(health);
  const items = result.items.map((conversation) =>
    conversationListItemView(conversation, filters, now),
  );
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const list = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <p className="admin-eyebrow">Administración</p>
          <h1 className="text-xl font-semibold text-[#fffbf4]">Mensajes</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <RefreshButton />
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/mensajes/sin-enviar">Sin enviar</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/mensajes/plantillas">Plantillas</Link>
          </Button>
        </div>
      </div>
      <MessagingHealthBanner view={healthView} showUnsentLink className="mx-4 mt-3 w-auto" />
      {canSend ? (
        <MessageSimulatorPanel
          mode={env.MESSAGING_MODE}
          appEnvironment={env.APP_ENV}
          action={simulateInboundMessageAction}
        />
      ) : null}
      <ConversationList
        items={items}
        activeContactId={selectedContactId}
        search={filters.search}
        unlinkedOnly={filters.unlinkedOnly}
      />
      <nav
        aria-label="Paginación de conversaciones"
        className="flex items-center justify-between gap-3 p-4"
      >
        {filters.page > 1 ? (
          <Button variant="link" asChild>
            <Link href={conversationHref(null, { ...filters, page: filters.page - 1 })}>
              Anteriores
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <span className="admin-muted text-xs">
          {filters.page} de {pages}
        </span>
        {filters.page < pages ? (
          <Button variant="link" asChild>
            <Link href={conversationHref(null, { ...filters, page: filters.page + 1 })}>
              Siguientes
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>
    </>
  );

  let newestInboundMessageId: string | null = null;
  let conversation = null;
  if (selectedConversation) {
    const header = conversationHeaderView(selectedConversation, now);
    const primaryRequest = selectedConversation.linkedRequests[0];
    const renderedTemplates =
      canSend && primaryRequest
        ? await renderTemplatesForRequest(postgresMessageTemplateRepository, primaryRequest)
        : null;
    const threadMessages = selectedConversation.messages.map(threadMessageView);
    newestInboundMessageId =
      threadMessages.filter((message) => message.direction === "INBOUND").at(-1)?.id ?? null;
    const controls = canSend ? (
      <ConversationControls
        contactId={selectedConversation.contact.id}
        linkedRequests={selectedConversation.linkedRequests}
        unlinkAction={unlinkContactAction}
        deleteAction={deleteConversationAction}
      />
    ) : undefined;
    conversation = (
      <>
        {hasUnreadMessages(selectedConversation) ? (
          <MarkConversationRead
            contactId={selectedConversation.contact.id}
            action={markConversationReadAction}
          />
        ) : null}
        <ConversationHeader
          header={header}
          controls={controls}
          linkByCodeAction={canSend ? linkContactByCodeAction : undefined}
        />
        <MessageThread
          key={`thread-${selectedConversation.contact.id}`}
          messages={threadMessages}
          username={selectedConversation.contact.username}
          canAct={canSend}
          retryAction={retryMessageAction}
          markSentAction={markSentManuallyAction}
          discardAction={discardMessageAction}
        />
        {canSend ? (
          <MessageComposer
            contactId={selectedConversation.contact.id}
            windowOpen={header.windowOpen}
            windowClosesAt={header.windowClosesAt}
            username={selectedConversation.contact.username}
            metaFailing={health.failing}
            sendAction={sendFreeTextAction}
            recordAction={recordManualMessageAction}
            templates={composerTemplatesView(header, renderedTemplates)}
          />
        ) : (
          <p className="admin-muted">
            Solo lectura: solo un superadministrador puede enviar mensajes.
          </p>
        )}
      </>
    );
  }

  return (
    <main>
      <MessagesLayout
        list={list}
        conversation={conversation}
        backHref={conversationHref(null, filters)}
      />
      <ConversationAutoRefresh
        key={selectedContactId ?? "list"}
        newestInboundMessageId={newestInboundMessageId}
      />
    </main>
  );
}
