"use client";

import { useRef, type RefObject } from "react";
import { MessageSquareText } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import type { ComposerTemplates } from "./message-copy";
import { firstLine } from "./template-list-view";

interface TemplateMenuProps {
  templates: ComposerTemplates | null;
  disabled: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChoose: (text: string) => void;
}

export function TemplateMenu({ templates, disabled, textareaRef, onChoose }: TemplateMenuProps) {
  const chosen = useRef(false);

  function choose(text: string) {
    chosen.current = true;
    onChoose(text);
  }

  function focusTextarea(event: Event) {
    if (!chosen.current) return;
    chosen.current = false;
    event.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Plantillas"
          disabled={disabled}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[#8d8b85] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:text-[#fffbf4] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#fffbf4]"
        >
          <MessageSquareText aria-hidden="true" className="size-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onCloseAutoFocus={focusTextarea}
          className="z-50 grid max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-[min(22rem,calc(100vw-1rem))] grid-cols-1 gap-0.5 overflow-y-auto rounded-2xl border border-border bg-background p-1.5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        >
          <div className="grid grid-cols-1 gap-0.5 px-3 pt-1.5 pb-2">
            <p className="admin-eyebrow">Plantillas</p>
            {templates ? (
              <p className="truncate text-xs text-[#8d8b85]">
                Con datos de {templates.sourceLabel}
              </p>
            ) : null}
          </div>
          {templates ? (
            templates.options.map((option) => (
              <DropdownMenu.Item
                key={option.key}
                textValue={option.title}
                onSelect={() => choose(option.text)}
                className="grid min-h-11 cursor-pointer grid-cols-1 gap-0.5 rounded-xl px-3 py-2 outline-none transition-colors duration-200 data-[highlighted]:bg-accent"
              >
                <span className="text-sm text-[#fffbf4]">{option.title}</span>
                <span className="truncate text-xs text-[#8d8b85]">{firstLine(option.text)}</span>
              </DropdownMenu.Item>
            ))
          ) : (
            <p className="px-3 pb-2 text-sm text-[#8d8b85]">
              Vincula la conversación a una solicitud para usar plantillas.
            </p>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
