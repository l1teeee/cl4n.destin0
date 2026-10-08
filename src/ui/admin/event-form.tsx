"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { NativeSelect } from "@/ui/primitives/native-select";

const initialState: AdminActionState = { ok: false, message: "" };

export interface EventFormValues {
  internalName: string;
  slug: string;
  eventDate: string;
  eventTime: string;
  opensAt: string;
  closesAt: string;
  capacity?: number;
  maxPartySize: number;
  autoCloseOnFull: boolean;
  waitlistCapacity?: number;
  status?: "DRAFT" | "SCHEDULED";
}

interface EventFormProps {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  values?: EventFormValues;
  mode: "create" | "edit";
  slugEditable?: boolean;
}

export function EventForm({ action, values, mode, slugEditable = true }: EventFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid max-w-3xl gap-5 md:grid-cols-2">
      <Label className="grid gap-2">
        <span>Nombre interno</span>
        <Input name="internalName" defaultValue={values?.internalName} maxLength={120} required />
      </Label>
      <Label className="grid gap-2">
        <span>Slug</span>
        <Input
          name="slug"
          defaultValue={values?.slug}
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          readOnly={!slugEditable}
          required
        />
      </Label>
      <Label className="grid gap-2">
        <span>Fecha del evento</span>
        <Input name="eventDate" type="date" defaultValue={values?.eventDate} required />
      </Label>
      <Label className="grid gap-2">
        <span>Hora del evento</span>
        <Input name="eventTime" type="time" defaultValue={values?.eventTime} required />
      </Label>
      {mode === "create" ? (
        <Label className="grid gap-2">
          <span>Capacidad total</span>
          <Input name="capacity" type="number" min={1} defaultValue={values?.capacity} required />
        </Label>
      ) : null}
      <Label className="grid gap-2">
        <span>Tamaño máximo del grupo</span>
        <Input
          name="maxPartySize"
          type="number"
          min={1}
          defaultValue={values?.maxPartySize}
          required
        />
      </Label>
      <Label className="grid gap-2">
        <span>Lugares en cola</span>
        <Input
          name="waitlistCapacity"
          type="number"
          min={0}
          max={50}
          defaultValue={values?.waitlistCapacity ?? 5}
          required
        />
        <span className="admin-muted">0 desactiva la cola.</span>
      </Label>
      <Label className="grid gap-2">
        <span>Apertura</span>
        <Input name="opensAt" type="datetime-local" defaultValue={values?.opensAt} required />
      </Label>
      <Label className="grid gap-2">
        <span>Cierre</span>
        <Input name="closesAt" type="datetime-local" defaultValue={values?.closesAt} required />
      </Label>
      {mode === "create" ? (
        <Label className="grid gap-2">
          <span>Estado inicial</span>
          <NativeSelect name="status" defaultValue={values?.status ?? "DRAFT"}>
            <option value="DRAFT">Borrador</option>
            <option value="SCHEDULED">Programada</option>
          </NativeSelect>
        </Label>
      ) : null}
      <Label className="flex items-center gap-2 md:col-span-2">
        <input
          className="admin-checkbox"
          name="autoCloseOnFull"
          type="checkbox"
          defaultChecked={values?.autoCloseOnFull}
        />
        Cerrar automáticamente al alcanzar la capacidad
      </Label>
      <div className="space-y-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Guardando..." : mode === "create" ? "Crear experiencia" : "Guardar cambios"}
        </Button>
        {state.message ? (
          <Alert variant={state.ok ? "success" : "destructive"} role="status">
            {state.message}
          </Alert>
        ) : null}
      </div>
    </form>
  );
}
