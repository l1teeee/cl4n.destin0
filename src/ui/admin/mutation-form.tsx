"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";

const initialState: AdminActionState = { ok: false, message: "" };

type MutationAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

interface MutationFormProps {
  action: MutationAction;
  label: string;
  children?: ReactNode;
  confirmation?: string;
  danger?: boolean;
}

function FormContent({
  label,
  children,
  danger,
  pending,
}: Omit<MutationFormProps, "action" | "confirmation"> & { pending: boolean }) {
  return (
    <>
      {children}
      <button
        type="submit"
        disabled={pending}
        className={danger ? "admin-button-danger" : "admin-button-ghost"}
      >
        {pending ? "Procesando..." : label}
      </button>
    </>
  );
}

export function MutationForm({
  action,
  label,
  children,
  confirmation,
  danger = false,
}: MutationFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const form = (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <FormContent label={label} danger={danger} pending={pending}>
        {children}
      </FormContent>
    </form>
  );

  return (
    <div className="space-y-2">
      {confirmation ? (
        <details className="admin-confirmation">
          <summary className="admin-link">{label}</summary>
          <p className="admin-secondary my-3 max-w-md text-sm">{confirmation}</p>
          {form}
        </details>
      ) : (
        form
      )}
      {state.message ? (
        <p className={state.ok ? "admin-notice-success" : "admin-notice-error"} role="status">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
