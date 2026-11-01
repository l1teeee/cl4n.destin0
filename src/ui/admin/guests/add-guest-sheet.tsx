"use client";

import { useState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { useActionFeedback } from "@/ui/admin/action-feedback";
import { Button } from "@/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/ui/primitives/sheet";

import { GuestRequestForm } from "./guest-request-form";

interface AddGuestSheetProps {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  allowCouple: boolean;
}

export function AddGuestSheet({ action, allowCouple }: AddGuestSheetProps) {
  const feedback = useActionFeedback();
  const [open, setOpen] = useState(false);
  // The form keeps what was typed after a save, so a new key gives the next person an empty form.
  const [formKey, setFormKey] = useState(0);

  async function addGuest(state: AdminActionState, formData: FormData) {
    const result = await action(state, formData);
    if (result.ok) {
      feedback?.report(result);
      setOpen(false);
      setFormKey((key) => key + 1);
    }
    return result;
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">Agregar persona</Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-border sm:max-w-2xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>Agregar persona</SheetTitle>
          <SheetDescription>
            Entra a la lista para revisión si hay lugar; si no, entra a la cola.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-8">
          <GuestRequestForm
            key={formKey}
            action={addGuest}
            submitLabel="Agregar persona"
            allowCouple={allowCouple}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
