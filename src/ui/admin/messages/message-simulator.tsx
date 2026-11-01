"use client";

import { useActionState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Textarea } from "@/ui/primitives/textarea";

type SimulatorAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

const initialState: AdminActionState = { ok: false, message: "" };

export function MessageSimulator({ action }: { action: SimulatorAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <details className="border-b border-border p-4">
      <summary className="cursor-pointer font-medium">Simulador (solo local)</summary>
      <form action={formAction} className="mt-4 grid gap-3">
        <p className="admin-muted text-sm">
          Simula que una persona escribe por Instagram, por ejemplo con el código de su solicitud.
        </p>
        <Input
          name="username"
          aria-label="Usuario de Instagram"
          placeholder="ana.ejemplo"
          required
        />
        <Textarea name="text" aria-label="Mensaje simulado" placeholder="Hola" required />
        <Input
          name="linkCode"
          aria-label="Código opcional"
          placeholder="Código opcional"
          minLength={6}
          maxLength={6}
          className="font-mono uppercase"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Simulando..." : "Simular mensaje"}
        </Button>
        {state.message ? (
          <Alert variant={state.ok ? "success" : "destructive"} role="status">
            {state.message}
          </Alert>
        ) : null}
      </form>
    </details>
  );
}
