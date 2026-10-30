"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";
import { Textarea } from "@/ui/primitives/textarea";

import { CopyTextButton, OpenInstagramChatLink } from "./manual-send-buttons";
import { windowCopy, type ComposerAction } from "./message-copy";

const MAX_TEXT_LENGTH = 1000;
const TEXT_ERROR_ID = "message-composer-text-error";

const initialState: AdminActionState = { ok: false, message: "" };

interface MessageComposerProps {
  contactId: string;
  windowOpen: boolean;
  windowClosesAt: Date | null;
  username: string | null;
  sendAction: ComposerAction;
}

export function MessageComposer({
  contactId,
  windowOpen,
  windowClosesAt,
  username,
  sendAction,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [state, formAction, pending] = useActionState(
    async (previousState: AdminActionState, formData: FormData) => {
      const result = await sendAction(contactId, previousState, formData);
      if (result.ok) setText("");
      return result;
    },
    initialState,
  );
  const textError = state.fieldErrors?.text;
  const blank = text.trim().length === 0;
  const offersManualSend = !windowOpen;

  return (
    <form
      action={formAction}
      className="grid shrink-0 gap-3 border-t border-border px-4 py-3 sm:px-6"
    >
      <p className="admin-muted text-sm">
        {windowCopy({ open: windowOpen, closesAt: windowClosesAt })}
      </p>
      <div className="grid gap-1">
        <Textarea
          name="text"
          aria-label="Mensaje"
          aria-invalid={Boolean(textError)}
          aria-describedby={textError ? TEXT_ERROR_ID : undefined}
          placeholder="Escribe tu respuesta"
          rows={3}
          maxLength={MAX_TEXT_LENGTH}
          required
          readOnly={pending}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          className="max-h-48"
        />
        <FieldError id={TEXT_ERROR_ID} message={textError} />
        <p className="text-right text-xs text-[#8d8b85]">
          {text.length}/{MAX_TEXT_LENGTH}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {offersManualSend ? <CopyTextButton text={text} label="Copiar" disabled={blank} /> : null}
        {offersManualSend && username ? <OpenInstagramChatLink username={username} /> : null}
        <Button type="submit" size="sm" disabled={pending || blank}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Enviando..." : "Enviar"}
        </Button>
      </div>
      {state.message ? (
        <Alert variant={state.ok ? "success" : "destructive"} role="status">
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}
