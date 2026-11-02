import type { ReactNode } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Badge } from "@/ui/primitives/badge";

import { instagramProfileHref, windowCopy, type ConversationHeaderView } from "./message-copy";

interface ConversationHeaderProps {
  header: ConversationHeaderView;
  controls?: ReactNode;
}

function LinkedRequests({ linked }: Pick<ConversationHeaderView, "linked">) {
  if (linked.length === 0) {
    return (
      <p className="admin-muted text-sm">
        Esta conversación no está vinculada a ninguna solicitud.
      </p>
    );
  }

  return (
    <ul aria-label="Solicitudes vinculadas" className="grid gap-2">
      {linked.map((request) => (
        <li
          key={`${request.kind}-${request.id}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
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

export function ConversationHeader({ header, controls }: ConversationHeaderProps) {
  return (
    <header className="grid shrink-0 gap-3 border-b border-border px-4 py-4 sm:px-6">
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
      <p className="admin-muted text-sm">
        {windowCopy({ open: header.windowOpen, closesAt: header.windowClosesAt })}
      </p>
      <LinkedRequests linked={header.linked} />
      {controls}
    </header>
  );
}
