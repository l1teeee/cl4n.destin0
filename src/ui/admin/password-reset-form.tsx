"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import {
  completePasswordResetAction,
  type PasswordResetFormState,
} from "@/app/admin/reset/actions";
import { PASSWORD_RESET_INVALID_LINK_MESSAGE } from "@/contracts/admin-auth";

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
        <p className="admin-notice-error" role="alert">
          {PASSWORD_RESET_INVALID_LINK_MESSAGE}
        </p>
        <Link className="admin-link" href="/admin/forgot">
          Solicitar un nuevo enlace
        </Link>
      </>
    );
  }

  return (
    <>
      {state.message ? (
        <p className="admin-notice-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <form action={formAction} className="grid gap-4">
        <input type="hidden" name="token" value={token ?? ""} />
        <label className="admin-label grid gap-2">
          <span>Nueva contraseña</span>
          <input
            className="admin-input"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <label className="admin-label grid gap-2">
          <span>Confirmar contraseña</span>
          <input
            className="admin-input"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <button className="admin-button admin-button-full mt-2" type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar contraseña"}
        </button>
      </form>
    </>
  );
}
