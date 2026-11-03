import Link from "next/link";
import { Search, TriangleAlert } from "lucide-react";

import { cn } from "@/ui/cn";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/primitives/tooltip";

import type { ConversationListItemView } from "./message-copy";

const MISMATCH_COPY = "El usuario no coincide con la solicitud";

interface ConversationListProps {
  items: readonly ConversationListItemView[];
  activeContactId: string | null;
  search: string;
  unlinkedOnly: boolean;
}

function MismatchMark() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={MISMATCH_COPY}
          className="inline-flex shrink-0 text-destructive"
        >
          <TriangleAlert aria-hidden="true" className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{MISMATCH_COPY}</TooltipContent>
    </Tooltip>
  );
}

function initialsOf(title: string): string {
  const words = title
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

function ConversationAvatar({ title }: { title: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-[#fffbf4]"
    >
      {initialsOf(title)}
    </span>
  );
}

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span className="size-2.5 shrink-0 rounded-full bg-primary">
      <span className="sr-only">
        {count === 1 ? "1 mensaje sin leer" : `${count} mensajes sin leer`}
      </span>
    </span>
  );
}

function ConversationRow({ item, active }: { item: ConversationListItemView; active: boolean }) {
  const showUsername = item.username !== null && item.title !== `@${item.username}`;

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-14 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent",
          active && "bg-muted [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
        )}
      >
        <ConversationAvatar title={item.title} />
        <span className="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-[#fffbf4]">{item.title}</span>
              {item.mismatch ? <MismatchMark /> : null}
            </span>
            <span className="shrink-0 text-xs text-[#8d8b85]">{item.lastActivityLabel}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-[#8d8b85]">
            {showUsername ? <span className="shrink-0">@{item.username}</span> : null}
            {showUsername ? <span aria-hidden="true">·</span> : null}
            <span className="truncate">{item.linkedLabel ?? "Sin vincular"}</span>
          </span>
          <span className="flex items-center justify-between gap-3">
            <span className="truncate text-sm text-[#8d8b85]">{item.preview}</span>
            <UnreadDot count={item.unreadCount} />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function ConversationList({
  items,
  activeContactId,
  search,
  unlinkedOnly,
}: ConversationListProps) {
  return (
    <div>
      <form method="get" className="grid gap-3 p-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#8d8b85]"
          />
          <Input
            name="q"
            type="text"
            aria-label="Buscar por usuario"
            placeholder="Buscar por usuario"
            defaultValue={search}
            autoComplete="off"
            className="rounded-full pl-10"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-border px-4 text-sm text-[#8d8b85] transition-colors duration-200 has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary/40">
            <input
              name="sinVincular"
              type="checkbox"
              value="1"
              defaultChecked={unlinkedOnly}
              className="sr-only"
            />
            <span>Solo sin vincular</span>
          </label>
          <Button type="submit" variant="outline" size="sm" className="ml-auto h-11 md:h-9">
            Buscar
          </Button>
        </div>
      </form>
      {items.length === 0 ? (
        <p className="admin-empty p-4 text-sm">No hay conversaciones todavía.</p>
      ) : (
        <ul aria-label="Conversaciones" className="grid gap-1 px-2 pb-2">
          {items.map((item) => (
            <ConversationRow
              key={item.contactId}
              item={item}
              active={item.contactId === activeContactId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
