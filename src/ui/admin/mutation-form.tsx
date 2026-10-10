"use client";

import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { useActionFeedback } from "@/ui/admin/action-feedback";
import { Alert } from "@/ui/primitives/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/primitives/alert-dialog";
import { Button } from "@/ui/primitives/button";

const initialState: AdminActionState = { ok: false, message: "" };

type MutationAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

interface MutationFormProps {
  action: MutationAction;
  label: string;
  children?: ReactNode;
  confirmation?: string;
  danger?: boolean;
  reportToSection?: boolean;
}

function FormContent({
  label,
  children,
  danger,
  pending,
}: Omit<MutationFormProps, "action" | "confirmation" | "reportToSection"> & { pending: boolean }) {
  return (
    <>
      {children}
      <Button type="submit" disabled={pending} variant={danger ? "destructive" : "outline"}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "Procesando..." : label}
      </Button>
    </>
  );
}

export function MutationForm({
  action,
  label,
  children,
  confirmation,
  danger = false,
  reportToSection = false,
}: MutationFormProps) {
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previousState: AdminActionState, formData: FormData) => {
      const result = await action(previousState, formData);
      if (result.ok) setOpen(false);
      if (result.ok && reportToSection && feedback) feedback.report(result);
      return result;
    },
    initialState,
  );
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
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant={danger ? "destructive" : "outline"}>{label}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{label}</AlertDialogTitle>
              <AlertDialogDescription>{confirmation}</AlertDialogDescription>
            </AlertDialogHeader>
            <form action={formAction} className="grid gap-4">
              {children}
              {!state.ok && state.message ? (
                <Alert variant="destructive" role="status">
                  {state.message}
                </Alert>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button
                  type="submit"
                  disabled={pending}
                  variant={danger ? "destructive" : "default"}
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {pending ? "Procesando..." : label}
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        form
      )}
      {state.message &&
      (!confirmation || state.ok) &&
      !(reportToSection && feedback && state.ok) ? (
        <Alert variant={state.ok ? "success" : "destructive"} role="status">
          {state.message}
        </Alert>
      ) : null}
    </div>
  );
}
