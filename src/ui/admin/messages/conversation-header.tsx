"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { cn } from "@/ui/cn";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";

import { LinkByCodeForm, type LinkByCodeAction } from "./link-by-code-form";
import { instagramProfileHref, windowCopy, type ConversationHeaderView } from "./message-copy";

interface ConversationHeaderProps {
  header: ConversationHeaderView;
  controls?: ReactNode;
  // Only passed to admins who may send messages.
  linkByCodeAction?: LinkByCodeAction;
}

const LINK_PANEL_ID = "link-by-code-panel";

function LinkedRequests({ linked }: Pick<ConversationHeaderView, "linked">) {
  if (linked.length === 0) {
    return <p className="admin-muted text-sm">Sin vincular a una solicitud</p>;
  }

  return (
    <ul aria-label="Solicitudes vinculadas" className="grid gap-2 md:justify-items-end">
      {linked.map((request) => (
        <li
          key={`${request.kind}-${request.id}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm md:justify-end"
        >
          <Link
            href={request.href}
            className="underline underline-offset-4 transition-opacity duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-60"
          >
            {request.label}
          </Link>
          <Badge>{request.statusLabel}</Badge>
          {request.mismatch ? (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              El usuario no coincide con la solicitud
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ConversationHeader({
  header,
  controls,
  linkByCodeAction,
}: ConversationHeaderProps) {
  const [linkFormOpen, setLinkFormOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const canLinkByCode = linkByCodeAction !== undefined && header.linked.length === 0;

  function closeLinkForm() {
    setLinkFormOpen(false);
    toggle.current?.focus();
  }

  return (
    <header className="grid shrink-0 gap-3 border-b border-border px-4 py-4 sm:px-6">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] md:items-start md:gap-6">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-[#fffbf4]">{header.title}</h2>
          {header.username ? (
            <a
              href={instagramProfileHref(header.username)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#8d8b85] transition-colors duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#fffbf4]"
            >
              @{header.username}
            </a>
          ) : null}
        </div>
        <div className="grid min-w-0 gap-1 md:justify-items-end md:text-right">
          <p className="admin-muted text-sm">
            {windowCopy({ open: header.windowOpen, closesAt: header.windowClosesAt })}
          </p>
          <LinkedRequests linked={header.linked} />
          {canLinkByCode ? (
            <Button
              ref={toggle}
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-11 md:h-9"
              aria-expanded={linkFormOpen}
              aria-controls={LINK_PANEL_ID}
              onClick={() => setLinkFormOpen((open) => !open)}
            >
              Vincular por código
            </Button>
          ) : null}
        </div>
      </div>
      {controls}
      {canLinkByCode ? (
        <div
          id={LINK_PANEL_ID}
          inert={!linkFormOpen}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            linkFormOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <LinkByCodeForm
              contactId={header.contactId}
              action={linkByCodeAction}
              open={linkFormOpen}
              onClose={closeLinkForm}
            />
          </div>
        </div>
      ) : null}
    </header>
  );
}
