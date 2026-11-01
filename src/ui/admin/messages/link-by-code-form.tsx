"use client";

import { useActionState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";

const initialState: AdminActionState = { ok: false, message: "" };

type LinkByCodeAction = (
  contactId: string,
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export function LinkByCodeForm({
  contactId,
  action,
}: {
  contactId: string;
  action: LinkByCodeAction;
}) {
  const [state, formAction, pending] = useActionState(action.bind(null, contactId), initialState);

  return (
    <form action={formAction} className="grid gap-2 sm:max-w-sm">
      <div className="flex items-end gap-2">
        <label className="grid flex-1 gap-1 text-sm">
          <span>Vincular por código</span>
          <Input
            name="code"
            aria-label="Código de solicitud"
            minLength={6}
            maxLength={6}
            autoComplete="off"
            className="font-mono uppercase"
            required
          />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Vinculando..." : "Vincular"}
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
