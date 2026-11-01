"use client";

import { useEffect, useRef } from "react";

import { MutationForm } from "@/ui/admin/mutation-form";
import { cn } from "@/ui/cn";
import { Badge } from "@/ui/primitives/badge";

import { CopyTextButton, OpenInstagramChatLink } from "./manual-send-buttons";
import {
  messageKindLabel,
  messageStatusCopy,
  type MessageAction,
  type MessageStatus,
  type ThreadMessageView,
} from "./message-copy";

const manualFallbackStatuses: ReadonlySet<MessageStatus> = new Set([
  "WAITING_CONTACT",
  "WAITING_WINDOW",
  "FAILED",
]);
const retryableStatuses: ReadonlySet<MessageStatus> = new Set(["WAITING_WINDOW", "FAILED"]);

// MutationForm has no size prop, so its buttons are matched to Button size="sm" from here.
const compactMutationButtons = "[&_button]:h-9 [&_button]:px-4 [&_button]:text-sm";

interface MessageActions {
  retryAction: MessageAction;
  markSentAction: MessageAction;
  discardAction: MessageAction;
}

interface MessageThreadProps extends MessageActions {
  messages: readonly ThreadMessageView[];
  username: string | null;
  // The chat panel follows the newest message; a thread inside a sheet must not scroll the sheet.
  scrollToNewest?: boolean;
}

interface MessageItemProps extends MessageActions {
  message: ThreadMessageView;
  username: string | null;
}

function MessageImages({ srcs }: { srcs: readonly string[] }) {
  if (srcs.length === 0) return null;

  return (
    <ul aria-label="Imágenes del mensaje" className="flex flex-wrap gap-2">
      {srcs.map((src, index) => (
        <li key={src}>
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="block size-24 border border-border"
          >
            {/* Message images come from an authenticated same-origin route, so next/image adds nothing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`Imagen ${index + 1} del mensaje`}
              loading="lazy"
              className="size-full object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

function ManualFallbackActions({
  message,
  username,
  retryAction,
  markSentAction,
  discardAction,
}: MessageItemProps) {
  return (
    <div className={cn("flex flex-wrap items-start gap-2", compactMutationButtons)}>
      {retryableStatuses.has(message.status) ? (
        <MutationForm action={retryAction.bind(null, message.id)} label="Reintentar" />
      ) : null}
      {message.body ? <CopyTextButton text={message.body} label="Copiar texto" /> : null}
      {username ? <OpenInstagramChatLink username={username} /> : null}
      <MutationForm action={markSentAction.bind(null, message.id)} label="Ya lo envié" />
      <MutationForm
        action={discardAction.bind(null, message.id)}
        label="Descartar"
        confirmation="El mensaje no se enviará a la persona. Confirma para continuar."
        danger
      />
    </div>
  );
}

function MessageBubble({
  message,
  username,
  retryAction,
  markSentAction,
  discardAction,
}: MessageItemProps) {
  const outbound = message.direction === "OUTBOUND";
  const status = messageStatusCopy(message.status);
  const needsManualFallback = outbound && manualFallbackStatuses.has(message.status);

  return (
    <li className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "grid max-w-[85%] min-w-0 gap-2 border px-3 py-2 sm:max-w-[70%]",
          outbound ? "border-primary/30 bg-accent" : "border-border",
        )}
      >
        <p
          className={cn(
            "text-[0.65rem] tracking-[0.18em] text-[#8d8b85] uppercase",
            !outbound && "sr-only",
          )}
        >
          {messageKindLabel(message.kind)}
        </p>
        {message.body ? <p className="break-words whitespace-pre-line">{message.body}</p> : null}
        <MessageImages srcs={message.imageSrcs} />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-[#8d8b85]">
          {outbound ? <Badge variant={status.variant}>{status.label}</Badge> : null}
          <span>{message.timeLabel}</span>
          {message.source === "INSTAGRAM_APP" ? <span>Desde Instagram</span> : null}
        </div>
        {message.status === "FAILED" && message.lastError ? (
          <p className="text-xs text-destructive">{message.lastError}</p>
        ) : null}
        {needsManualFallback ? (
          <ManualFallbackActions
            message={message}
            username={username}
            retryAction={retryAction}
            markSentAction={markSentAction}
            discardAction={discardAction}
          />
        ) : null}
      </div>
    </li>
  );
}

export function MessageThread({
  messages,
  username,
  retryAction,
  markSentAction,
  discardAction,
  scrollToNewest = true,
}: MessageThreadProps) {
  const end = useRef<HTMLDivElement>(null);
  const newestMessageId = messages.at(-1)?.id;

  // The component stays mounted when another conversation opens, so follow the newest message id.
  useEffect(() => {
    if (scrollToNewest) end.current?.scrollIntoView({ block: "end" });
  }, [newestMessageId, scrollToNewest]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
      {messages.length === 0 ? (
        <p className="admin-empty">Todavía no hay mensajes.</p>
      ) : (
        <ol aria-label="Mensajes" className="grid gap-3">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              username={username}
              retryAction={retryAction}
              markSentAction={markSentAction}
              discardAction={discardAction}
            />
          ))}
        </ol>
      )}
      <div ref={end} />
    </div>
  );
}
