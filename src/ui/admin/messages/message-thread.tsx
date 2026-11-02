"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { ThreadMessageView } from "./message-copy";
import { MessageGroup, type MessageActions } from "./message-group";
import { buildThreadItems } from "./thread-grouping";

const JUMP_TO_LATEST_THRESHOLD_PX = 200;

interface MessageThreadProps extends MessageActions {
  messages: readonly ThreadMessageView[];
  username: string | null;
  canAct: boolean;
  // The chat panel follows the newest message; a thread inside a sheet must not scroll the sheet.
  scrollToNewest?: boolean;
}

export function MessageThread({
  messages,
  username,
  canAct,
  retryAction,
  markSentAction,
  discardAction,
  scrollToNewest = true,
}: MessageThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const newestMessageId = messages.at(-1)?.id;
  const [now] = useState(() => new Date());
  // Messages present on the first render appear at once; only later arrivals animate in.
  const [initialMessageIds] = useState(() => new Set(messages.map((message) => message.id)));
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const items = buildThreadItems(messages, now);
  const animatedMessageIds = new Set(
    messages.filter((message) => !initialMessageIds.has(message.id)).map((message) => message.id),
  );

  // The component stays mounted when another conversation opens, so follow the newest message id.
  useEffect(() => {
    if (scrollToNewest) end.current?.scrollIntoView({ block: "end" });
  }, [newestMessageId, scrollToNewest]);

  function updateJumpVisibility() {
    const element = scroller.current;
    if (!element) return;
    const distanceFromLatest = element.scrollHeight - element.scrollTop - element.clientHeight;
    setAwayFromLatest(distanceFromLatest > JUMP_TO_LATEST_THRESHOLD_PX);
  }

  function jumpToLatest() {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={updateJumpVisibility}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <div className="mx-auto w-full max-w-2xl">
          {messages.length === 0 ? (
            <p className="admin-empty">Todavía no hay mensajes.</p>
          ) : (
            <ol aria-label="Mensajes" className="grid gap-4">
              {items.map((item) =>
                item.kind === "day" ? (
                  <li key={item.key} className="flex justify-center">
                    <span className="rounded-full border border-border px-3 py-0.5 text-xs text-[#8d8b85]">
                      {item.label}
                    </span>
                  </li>
                ) : (
                  <MessageGroup
                    key={item.key}
                    group={item}
                    username={username}
                    canAct={canAct}
                    animatedMessageIds={animatedMessageIds}
                    retryAction={retryAction}
                    markSentAction={markSentAction}
                    discardAction={discardAction}
                  />
                ),
              )}
            </ol>
          )}
          <div ref={end} />
        </div>
      </div>
      {scrollToNewest && awayFromLatest ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-sm text-[#fffbf4] shadow-lg transition-opacity duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-70"
        >
          <ChevronDown aria-hidden="true" className="size-4" />
          Ir al último mensaje
        </button>
      ) : null}
    </div>
  );
}
