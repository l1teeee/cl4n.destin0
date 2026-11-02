"use client";

import { useActionState, useEffect, useRef, type KeyboardEvent } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";

const initialState: AdminActionState = { ok: false, message: "" };

export type LinkByCodeAction = (
  contactId: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

interface LinkByCodeFormProps {
  contactId: string;
  action: LinkByCodeAction;
  open: boolean;
  onClose: () => void;
}

export function LinkByCodeForm({ contactId, action, open, onClose }: LinkByCodeFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(
    async (previousState: AdminActionState, formData: FormData) => {
      const nextState = await action(contactId, previousState, formData);
      if (nextState.ok) onClose();
      return nextState;
    },
    initialState,
  );

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function closeOnEscape(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  }

  return (
    <form action={formAction} onKeyDown={closeOnEscape} className="grid gap-2 sm:max-w-sm">
      <div className="flex items-center gap-2">
        <Input
          ref={input}
          name="code"
          aria-label="Código de solicitud"
          minLength={6}
          maxLength={6}
          autoComplete="off"
          className="flex-1 font-mono uppercase"
          required
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Vinculando..." : "Vincular"}
        </Button>
        <Button type="button" variant="link" className="min-h-11" onClick={onClose}>
          Cancelar
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
