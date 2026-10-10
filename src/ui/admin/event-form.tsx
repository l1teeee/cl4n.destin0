"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Alert } from "@/ui/primitives/alert";
import { reconcileMapsLink } from "@/domain/event/event-location";
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
import { Textarea } from "@/ui/primitives/textarea";
import { SegmentedControl, SegmentedControlItem } from "@/ui/primitives/segmented-control";
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
  locationName: string | null;
  locationAddress: string | null;
  locationMapsUrl: string | null;
  locationNotes: string | null;
  locationStatus: "PENDING" | "CONFIRMED";
  locationRevision?: number;
}

interface EventFormProps {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  values?: EventFormValues;
  mode: "create" | "edit";
  slugEditable?: boolean;
}

export function EventForm({ action, values, mode, slugEditable = true }: EventFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [address, setAddress] = useState(values?.locationAddress ?? "");
  const [mapsUrl, setMapsUrl] = useState(values?.locationMapsUrl ?? "");
  const mapsLinkWillBeCleared =
    mode === "edit" &&
    reconcileMapsLink(
      { address: values?.locationAddress ?? null, mapsUrl: values?.locationMapsUrl ?? null },
      { address: address.trim() === "" ? null : address, mapsUrl: mapsUrl.trim() },
      false,
    ).mapsUrlCleared;
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  return (
    <form onSubmit={handleSubmit} className="grid max-w-3xl gap-5 md:grid-cols-2">
      {mode === "edit" && values?.locationRevision !== undefined ? (
        <>
          <input type="hidden" name="locationRevision" value={values.locationRevision} />
          <input type="hidden" name="locationStatusLoaded" value={values.locationStatus} />
        </>
      ) : null}
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
      {mode === "create" ? (
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
      ) : null}
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
      <section className="grid gap-5 border-t border-border pt-5 md:col-span-2 md:grid-cols-2">
        <h2 className="text-xs font-bold tracking-[0.2em] uppercase md:col-span-2">Ubicación</h2>
        <div className="grid gap-2">
          <Label htmlFor="locationName">Nombre del lugar</Label>
          <Input
            id="locationName"
            name="locationName"
            defaultValue={values?.locationName ?? ""}
            maxLength={120}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="locationAddress">Dirección</Label>
          <Textarea
            id="locationAddress"
            name="locationAddress"
            defaultValue={values?.locationAddress ?? ""}
            onChange={(event) => setAddress(event.target.value)}
            maxLength={300}
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="locationMapsUrl">Enlace de Google Maps</Label>
            <FieldHint label="Cómo obtener el enlace">
              En Google Maps abre el lugar, toca Compartir y copia el enlace.
            </FieldHint>
          </div>
          <Input
            id="locationMapsUrl"
            name="locationMapsUrl"
            type="url"
            defaultValue={values?.locationMapsUrl ?? ""}
            onChange={(event) => setMapsUrl(event.target.value)}
            maxLength={2048}
          />
          {mapsLinkWillBeCleared ? (
            <div className="grid gap-2">
              <p className="admin-muted">
                Cambiaste la dirección. Al guardar se quitará el enlace de Google Maps anterior y se
                usará la nueva dirección. Pega el enlace nuevo para marcar el punto exacto.
              </p>
              <div className="flex items-center gap-2">
                <input
                  id="keepMapsUrl"
                  name="keepMapsUrl"
                  type="checkbox"
                  className="size-4 accent-current"
                />
                <Label htmlFor="keepMapsUrl">Mantener el enlace de Google Maps actual</Label>
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="locationNotes">Indicaciones</Label>
          <Textarea
            id="locationNotes"
            name="locationNotes"
            defaultValue={values?.locationNotes ?? ""}
            maxLength={1000}
            placeholder="Cómo llegar o entrar, por ejemplo el timbre o el código de la puerta."
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <span className="text-sm font-medium">Estado de la ubicación</span>
          <SegmentedControl
            name="locationStatus"
            defaultValue={values?.locationStatus ?? "PENDING"}
            aria-label="Estado de la ubicación"
          >
            <SegmentedControlItem value="PENDING">Por confirmar</SegmentedControlItem>
            <SegmentedControlItem value="CONFIRMED">Confirmada</SegmentedControlItem>
          </SegmentedControl>
          <p className="admin-muted">
            Márcala como confirmada cuando el lugar sea definitivo. Puedes cambiarla después.
          </p>
          {mode === "create" ? (
            <p className="admin-muted">
              Las imágenes del lugar se agregan después de crear la experiencia, desde Editar.
            </p>
          ) : null}
        </div>
      </section>
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
