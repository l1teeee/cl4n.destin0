"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
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
import { DateTimePicker } from "@/ui/primitives/date-time-picker";
import { FieldError } from "@/ui/primitives/field-error";
import { Label } from "@/ui/primitives/label";

const initialState: AdminActionState = { ok: false, message: "" };

interface ReopenEventDialogProps {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  startsAt: Date;
}

function browserToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function ReopenEventDialog({ action, startsAt }: ReopenEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (previousState: AdminActionState, formData: FormData) => {
      const result = await action(previousState, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    initialState,
  );
  const closesAtError = state.fieldErrors?.closesAt;
  const formattedStartsAt = formatUtcForElSalvador(startsAt, "dd/MM/yyyy HH:mm");

  return (
    <div className="flex flex-wrap items-center gap-3">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline">
            Abrir de nuevo la experiencia
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abrir de nuevo la experiencia</AlertDialogTitle>
            <AlertDialogDescription>
              La experiencia se abrirá ahora. ¿Hasta cuándo necesitas que esté abierta?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="reopen-closesAt">Abierta hasta</Label>
              <DateTimePicker
                id="reopen-closesAt"
                name="closesAt"
                disabledBefore={browserToday()}
                disabledAfter={startsAt}
                invalid={Boolean(closesAtError)}
                describedBy={
                  closesAtError
                    ? "reopen-closesAt-error reopen-closesAt-hint"
                    : "reopen-closesAt-hint"
                }
              />
              <FieldError id="reopen-closesAt-error" message={closesAtError} />
              <p id="reopen-closesAt-hint" className="admin-muted">
                Debe cerrar antes de que empiece la experiencia ({formattedStartsAt})
              </p>
            </div>
            {!state.ok && state.message && !closesAtError ? (
              <Alert variant="destructive" role="status">
                {state.message}
              </Alert>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Abrir experiencia
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      {state.ok && state.message ? (
        <p role="status" className="admin-muted">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
