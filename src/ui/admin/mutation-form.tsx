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
        className={
          danger
            ? "rounded border border-red-500 px-3 py-2 text-sm text-red-200 disabled:opacity-50"
            : "rounded border border-zinc-600 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
        }
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
        <details className="rounded border border-zinc-700 p-2">
          <summary className="cursor-pointer text-sm">{label}</summary>
          <p className="my-2 max-w-md text-sm text-zinc-300">{confirmation}</p>
          {form}
        </details>
      ) : (
        form
      )}
      {state.message ? (
        <p className={state.ok ? "text-sm text-emerald-400" : "text-sm text-red-400"} role="status">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
