"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  completePasswordResetAction,
  type PasswordResetFormState,
} from "@/app/admin/reset/actions";
import { PASSWORD_RESET_INVALID_LINK_MESSAGE } from "@/contracts/admin-auth";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

const initialState: PasswordResetFormState = { message: "" };

export function PasswordResetForm() {
  const [state, formAction, pending] = useActionState(completePasswordResetAction, initialState);
  // undefined until the fragment is read, so the invalid-link message does not flash on load.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    // WHY: the fragment only exists in the browser, so it can only be read after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(fragment.get("token"));
    // WHY: dropping the fragment keeps the secret out of browser history and screenshots.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  if (token === null) {
    return (
      <>
        <Alert variant="destructive" role="alert">
          {PASSWORD_RESET_INVALID_LINK_MESSAGE}
        </Alert>
        <Button variant="link" asChild>
          <Link href="/admin/forgot">Solicitar un nuevo enlace</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      {state.message ? (
        <Alert variant="destructive" role="alert">
          {state.message}
        </Alert>
      ) : null}
      <form action={formAction} className="grid gap-4">
        <input type="hidden" name="token" value={token ?? ""} />
        <Label className="grid gap-2">
          <span>Nueva contraseña</span>
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Label>
        <Label className="grid gap-2">
          <span>Confirmar contraseña</span>
          <Input
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Label>
        <Button className="mt-2 w-full" type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Guardando..." : "Guardar contraseña"}
        </Button>
      </form>
    </>
  );
}
