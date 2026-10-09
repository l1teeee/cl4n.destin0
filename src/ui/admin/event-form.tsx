"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { DatePicker } from "@/ui/primitives/date-picker";
import { DateTimePicker } from "@/ui/primitives/date-time-picker";
import { FieldHint } from "@/ui/primitives/field-hint";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Switch } from "@/ui/primitives/switch";
import { TimePicker } from "@/ui/primitives/time-picker";

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
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="slug">Slug</Label>
          <FieldHint label="Qué es el slug">
            Es la parte final del enlace público de la experiencia, por ejemplo
            /solicitar/club-sait. Usa solo minúsculas, números y guiones, sin espacios. Solo puede
            cambiarse mientras la experiencia está en borrador.
          </FieldHint>
        </div>
        <Input
          id="slug"
          name="slug"
          defaultValue={values?.slug}
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          readOnly={!slugEditable}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="eventDate">Fecha del evento</Label>
        <DatePicker id="eventDate" name="eventDate" defaultValue={values?.eventDate} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="eventTime">Hora del evento</Label>
        <TimePicker id="eventTime" name="eventTime" defaultValue={values?.eventTime} />
      </div>
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
      <div className="grid gap-2">
        <Label htmlFor="opensAt">Apertura</Label>
        <DateTimePicker id="opensAt" name="opensAt" defaultValue={values?.opensAt} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="closesAt">Cierre</Label>
        <DateTimePicker id="closesAt" name="closesAt" defaultValue={values?.closesAt} />
      </div>
      {mode === "create" ? (
        <div className="grid gap-2">
          <Label htmlFor="status">Estado inicial</Label>
          <Select name="status" defaultValue={values?.status ?? "DRAFT"}>
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">Borrador</SelectItem>
              <SelectItem value="SCHEDULED">Programada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex items-center gap-2 md:col-span-2">
        <Switch
          id="autoCloseOnFull"
          name="autoCloseOnFull"
          defaultChecked={values?.autoCloseOnFull}
        />
        <Label htmlFor="autoCloseOnFull">Cerrar automáticamente al alcanzar la capacidad</Label>
      </div>
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
