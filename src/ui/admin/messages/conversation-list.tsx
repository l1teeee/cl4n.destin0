import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { cn } from "@/ui/cn";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/primitives/tooltip";

import type { ConversationListItemView } from "./message-copy";
import { UnreadCountBadge } from "./unread-count-badge";

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

function ConversationRow({ item, active }: { item: ConversationListItemView; active: boolean }) {
  return (
    <li className="border-b border-border">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-col gap-1 border-l-2 px-4 py-3 transition-colors duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent",
          active ? "border-primary bg-accent" : "border-transparent",
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-semibold text-[#fffbf4]">{item.title}</span>
          <span className="shrink-0 text-xs text-[#8d8b85]">{item.lastActivityLabel}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-[#8d8b85]">
          <span className="truncate">{item.linkedLabel ?? "Sin vincular"}</span>
          {item.mismatch ? <MismatchMark /> : null}
        </span>
        <span className="flex items-center justify-between gap-3">
          <span className="truncate text-sm text-[#8d8b85]">{item.preview}</span>
          <UnreadCountBadge count={item.unreadCount} />
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
      <form method="get" className="grid gap-3 border-b border-border p-4">
        <Label className="grid gap-2">
          <span>Buscar por usuario</span>
          <Input name="q" type="text" defaultValue={search} autoComplete="off" />
        </Label>
        <Label>
          <input
            name="sinVincular"
            type="checkbox"
            value="1"
            defaultChecked={unlinkedOnly}
            className="size-4 accent-current"
          />
          <span>Solo sin vincular</span>
        </Label>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      {items.length === 0 ? (
        <p className="admin-empty p-4 text-sm">No hay conversaciones todavía.</p>
      ) : (
        <ul aria-label="Conversaciones">
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
