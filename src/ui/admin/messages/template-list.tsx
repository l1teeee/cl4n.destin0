"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import type { TemplateKey } from "@/domain/messaging/message-types";
import { cn } from "@/ui/cn";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

import { TemplateEditor, type TemplateEditorProps } from "./template-editor";
import {
  filterTemplates,
  firstLine,
  groupTemplates,
  type TemplateListItem,
} from "./template-list-view";

interface TemplateListProps {
  items: readonly TemplateListItem[];
  readOnly: boolean;
  action: TemplateEditorProps["action"];
}

function TemplateRow({
  item,
  open,
  readOnly,
  action,
  onToggle,
  onClose,
}: {
  item: TemplateListItem;
  open: boolean;
  readOnly: boolean;
  action: TemplateEditorProps["action"];
  onToggle: () => void;
  onClose: () => void;
}) {
  const panelId = useId();
  const rowButton = useRef<HTMLButtonElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    rowButton.current?.focus();
    onClose();
  }

  return (
    <li className="border-b border-[#2b2c26]" onKeyDown={handleKeyDown}>
      <h3>
        <button
          ref={rowButton}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="grid min-h-11 w-full gap-1 py-4 text-left [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent"
        >
          <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-base text-foreground">{item.title}</span>
            <span className="text-xs text-[#8d8b85]">{item.editedLabel}</span>
          </span>
          <span className="text-sm text-[#8d8b85]">{item.timing}</span>
          <span className="truncate text-sm text-[var(--clan-muted)]">{firstLine(item.body)}</span>
        </button>
      </h3>
      <div
        id={panelId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden px-1">
          <TemplateEditor
            templateKey={item.key}
            title={item.title}
            initialBody={item.body}
            variables={item.variables}
            updatedLabel={item.updatedLabel}
            readOnly={readOnly}
            action={action}
          />
        </div>
      </div>
    </li>
  );
}

export function TemplateList({ items, readOnly, action }: TemplateListProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<TemplateKey | null>(null);
  const visibleItems = filterTemplates(items, query);
  const groups = groupTemplates(visibleItems);

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Label htmlFor={searchId}>Buscar plantilla</Label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Ej. hola"
          autoComplete="off"
        />
      </div>
      {visibleItems.length === 0 ? (
        <p className="admin-empty">No hay plantillas con «{query.trim()}».</p>
      ) : (
        groups.map((group) => (
          <section key={group.title} aria-label={group.title}>
            <h2 className="admin-section-title">{group.title}</h2>
            <ul className="mt-2 border-t border-[#2b2c26]">
              {group.items.map((item) => (
                <TemplateRow
                  key={item.key}
                  item={item}
                  open={openKey === item.key}
                  readOnly={readOnly}
                  action={action}
                  onToggle={() => setOpenKey(openKey === item.key ? null : item.key)}
                  onClose={() => setOpenKey(null)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
