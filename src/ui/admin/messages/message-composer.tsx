"use client";

import { useActionState, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";

import { CopyTextButton, OpenInstagramChatLink } from "./manual-send-buttons";
import {
  META_FAILING_COMPOSER_COPY,
  windowCopy,
  type ComposerAction,
  type ComposerTemplates,
} from "./message-copy";
import { TemplateMenu } from "./template-menu";

const MAX_TEXT_LENGTH = 1000;
const COUNTER_THRESHOLD = MAX_TEXT_LENGTH * 0.8;
const TEXT_ERROR_ID = "message-composer-text-error";

const initialState: AdminActionState = { ok: false, message: "" };

interface MessageComposerProps {
  contactId: string;
  windowOpen: boolean;
  windowClosesAt: Date | null;
  username: string | null;
  metaFailing: boolean;
  sendAction: ComposerAction;
  recordAction: ComposerAction;
  templates: ComposerTemplates | null;
}

export function MessageComposer({
  contactId,
  windowOpen,
  windowClosesAt,
  username,
  metaFailing,
  sendAction,
  recordAction,
  templates,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction, pending] = useActionState(
    async (previousState: AdminActionState, formData: FormData) => {
      const result = await sendAction(contactId, previousState, formData);
      if (result.ok) setText("");
      return result;
    },
    initialState,
  );
  const [recordState, recordFormAction, recordPending] = useActionState(
    async (previousState: AdminActionState, formData: FormData) => {
      const result = await recordAction(contactId, previousState, formData);
      if (result.ok) setText("");
      return result;
    },
    initialState,
  );
  const textError = state.fieldErrors?.text;
  const blank = text.trim().length === 0;
  const offersManualSend = !windowOpen || metaFailing;

  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!blank && !pending) event.currentTarget.form?.requestSubmit();
  }

  return (
    <form action={formAction} className="shrink-0 px-4 pt-2 pb-3 sm:px-6">
      <div className="mx-auto grid w-full max-w-2xl gap-2">
        {offersManualSend ? (
          <div className="grid gap-2">
            <p className="admin-muted text-sm">
              {metaFailing
                ? META_FAILING_COMPOSER_COPY
                : windowCopy({ open: windowOpen, closesAt: windowClosesAt })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {username ? (
                <OpenInstagramChatLink username={username} text={blank ? null : text} />
              ) : (
                <CopyTextButton text={text} label="Copiar" disabled={blank} />
              )}
              <Button
                type="submit"
                variant="outline"
                size="sm"
                formAction={recordFormAction}
                disabled={blank || pending || recordPending}
              >
                Ya lo envié
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex items-end gap-2 rounded-[22px] border border-border bg-background p-1.5 transition-colors duration-200 focus-within:border-primary/50 has-[[aria-invalid=true]]:border-destructive">
          <TemplateMenu
            templates={templates}
            disabled={pending}
            textareaRef={textareaRef}
            onChoose={setText}
          />
          <textarea
            ref={textareaRef}
            name="text"
            aria-label="Mensaje"
            aria-invalid={Boolean(textError)}
            aria-describedby={textError ? TEXT_ERROR_ID : undefined}
            placeholder="Escribe un mensaje…"
            rows={1}
            maxLength={MAX_TEXT_LENGTH}
            required
            readOnly={pending || recordPending}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={sendOnEnter}
            className="block max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 pl-1 text-base leading-6 text-foreground field-sizing-content placeholder:text-muted-foreground focus-visible:outline-none read-only:opacity-50"
          />
          <button
            type="submit"
            aria-label={pending ? "Enviando" : "Enviar"}
            disabled={pending || recordPending || blank}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity duration-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ArrowUp aria-hidden="true" className="size-4" />
            )}
          </button>
        </div>
        <FieldError id={TEXT_ERROR_ID} message={textError} />
        {text.length > COUNTER_THRESHOLD ? (
          <p className="text-right text-xs text-[#8d8b85]">
            {text.length}/{MAX_TEXT_LENGTH}
          </p>
        ) : null}
        {state.message ? (
          <Alert variant={state.ok ? "success" : "destructive"} role="status">
            {state.message}
          </Alert>
        ) : null}
        {recordState.message ? (
          <Alert variant={recordState.ok ? "success" : "destructive"} role="status">
            {recordState.message}
          </Alert>
        ) : null}
      </div>
    </form>
  );
}
