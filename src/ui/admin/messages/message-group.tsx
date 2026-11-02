import { AlertCircle, Ban, Check, CheckCheck, Clock, type LucideIcon } from "lucide-react";

import { MutationForm } from "@/ui/admin/mutation-form";
import { cn } from "@/ui/cn";

import { MessageImages } from "./image-lightbox";
import { CopyTextButton, OpenInstagramChatLink } from "./manual-send-buttons";
import {
  messageDeliveryIndicator,
  messageKindLabel,
  type DeliveryIcon,
  type MessageAction,
  type MessageStatus,
  type ThreadMessageView,
} from "./message-copy";
import type { MessageGroup as MessageGroupView } from "./thread-grouping";

const manualFallbackStatuses: ReadonlySet<MessageStatus> = new Set([
  "WAITING_CONTACT",
  "WAITING_WINDOW",
  "FAILED",
]);
const retryableStatuses: ReadonlySet<MessageStatus> = new Set(["WAITING_WINDOW", "FAILED"]);

// MutationForm has no variant or size props, so its buttons are shaped into small pills from here.
const pillMutationButtons =
  "[&_button]:h-11 [&_button]:rounded-full [&_button]:px-4 [&_button]:text-xs [&_button]:font-medium [&_button]:tracking-normal sm:[&_button]:h-9";

const deliveryIcons: Record<DeliveryIcon, LucideIcon> = {
  clock: Clock,
  check: Check,
  "check-check": CheckCheck,
  alert: AlertCircle,
  ban: Ban,
};

export interface MessageActions {
  retryAction: MessageAction;
  markSentAction: MessageAction;
  discardAction: MessageAction;
}

interface MessageGroupProps extends MessageActions {
  group: MessageGroupView;
  username: string | null;
  canAct: boolean;
  animatedMessageIds: ReadonlySet<string>;
}

interface MessageItemProps extends MessageActions {
  message: ThreadMessageView;
  username: string | null;
  canAct: boolean;
  lastInGroup: boolean;
  animated: boolean;
}

function DeliveryStatus({ status }: { status: MessageStatus }) {
  const indicator = messageDeliveryIndicator(status);
  const Icon = deliveryIcons[indicator.icon];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        indicator.failed ? "text-destructive" : "text-[#8d8b85]",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {indicator.label}
    </span>
  );
}

function ManualFallbackActions({
  message,
  username,
  retryAction,
  markSentAction,
  discardAction,
}: Pick<MessageItemProps, "message" | "username" | keyof MessageActions>) {
  return (
    <div className={cn("flex flex-wrap items-start gap-2", pillMutationButtons)}>
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

function MessageItem({
  message,
  username,
  canAct,
  lastInGroup,
  animated,
  retryAction,
  markSentAction,
  discardAction,
}: MessageItemProps) {
  const outbound = message.direction === "OUTBOUND";
  const automatic = outbound && message.source === "SYSTEM";
  const needsAttention = outbound && manualFallbackStatuses.has(message.status);

  return (
    <li
      className={cn(
        "flex max-w-[88%] min-w-0 flex-col gap-1 sm:max-w-[80%]",
        outbound ? "items-end" : "items-start",
        animated && "admin-chat-in",
      )}
    >
      {automatic ? (
        <p className="px-1 text-[0.65rem] tracking-[0.12em] text-[#8d8b85] uppercase">
          Automático · {messageKindLabel(message.kind)}
        </p>
      ) : null}
      {!outbound ? <p className="sr-only">{messageKindLabel(message.kind)}</p> : null}
      <div
        className={cn(
          "grid min-w-0 gap-2 rounded-[18px] px-3.5 py-2 text-[0.9375rem] leading-[1.45]",
          outbound ? "bg-primary text-primary-foreground" : "bg-muted text-[#fffbf4]",
          lastInGroup && (outbound ? "rounded-br-[6px]" : "rounded-bl-[6px]"),
        )}
      >
        {message.body ? <p className="break-words whitespace-pre-line">{message.body}</p> : null}
        <MessageImages srcs={message.imageSrcs} username={username} />
      </div>
      {message.source === "INSTAGRAM_APP" ? (
        <p className="px-1 text-[0.7rem] text-[#8d8b85]">Desde Instagram</p>
      ) : null}
      {needsAttention ? (
        <div className="grid justify-items-end gap-2 px-1 text-xs">
          <DeliveryStatus status={message.status} />
          {message.status === "FAILED" && message.lastError ? (
            <p className="text-xs text-destructive">{message.lastError}</p>
          ) : null}
          {canAct ? (
            <ManualFallbackActions
              message={message}
              username={username}
              retryAction={retryAction}
              markSentAction={markSentAction}
              discardAction={discardAction}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function MessageGroup({
  group,
  username,
  canAct,
  animatedMessageIds,
  retryAction,
  markSentAction,
  discardAction,
}: MessageGroupProps) {
  const outbound = group.direction === "OUTBOUND";
  const lastMessage = group.messages[group.messages.length - 1]!;
  const showGroupStatus = outbound && !manualFallbackStatuses.has(lastMessage.status);

  return (
    <li className={cn("flex flex-col gap-1", outbound ? "items-end" : "items-start")}>
      <ul
        className={cn("flex w-full flex-col gap-1", outbound ? "items-end" : "items-start")}
        aria-label={outbound ? "Mensajes enviados" : "Mensajes recibidos"}
      >
        {group.messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            username={username}
            canAct={canAct}
            lastInGroup={message === lastMessage}
            animated={animatedMessageIds.has(message.id)}
            retryAction={retryAction}
            markSentAction={markSentAction}
            discardAction={discardAction}
          />
        ))}
      </ul>
      <p className="flex items-center gap-2 px-1 text-[0.7rem] text-[#8d8b85]">
        <span>{group.timeLabel}</span>
        {showGroupStatus ? <DeliveryStatus status={lastMessage.status} /> : null}
      </p>
    </li>
  );
}
