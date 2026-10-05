"use client";

import { useActionState } from "react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";

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
  status?: "DRAFT" | "SCHEDULED";
}

interface EventFormProps {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  values?: EventFormValues;
  mode: "create" | "edit";
  slugEditable?: boolean;
}

const inputClass = "rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100";

export function EventForm({ action, values, mode, slugEditable = true }: EventFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="grid max-w-3xl gap-5 md:grid-cols-2">
      <label className="grid gap-1">
        <span>Nombre interno</span>
        <input
          className={inputClass}
          name="internalName"
          defaultValue={values?.internalName}
          maxLength={120}
          required
        />
      </label>
      <label className="grid gap-1">
        <span>Slug</span>
        <input
          className={inputClass}
          name="slug"
          defaultValue={values?.slug}
          maxLength={80}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          readOnly={!slugEditable}
          required
        />
      </label>
      <label className="grid gap-1">
        <span>Fecha del evento</span>
        <input
          className={inputClass}
          name="eventDate"
          type="date"
          defaultValue={values?.eventDate}
          required
        />
      </label>
      <label className="grid gap-1">
        <span>Hora del evento</span>
        <input
          className={inputClass}
          name="eventTime"
          type="time"
          defaultValue={values?.eventTime}
          required
        />
      </label>
      {mode === "create" ? (
        <label className="grid gap-1">
          <span>Capacidad total</span>
          <input
            className={inputClass}
            name="capacity"
            type="number"
            min={1}
            defaultValue={values?.capacity}
            required
          />
        </label>
      ) : null}
      <label className="grid gap-1">
        <span>Tamaño máximo del grupo</span>
        <input
          className={inputClass}
          name="maxPartySize"
          type="number"
          min={1}
          defaultValue={values?.maxPartySize}
          required
        />
      </label>
      <label className="grid gap-1">
        <span>Apertura</span>
        <input
          className={inputClass}
          name="opensAt"
          type="datetime-local"
          defaultValue={values?.opensAt}
          required
        />
      </label>
      <label className="grid gap-1">
        <span>Cierre</span>
        <input
          className={inputClass}
          name="closesAt"
          type="datetime-local"
          defaultValue={values?.closesAt}
          required
        />
      </label>
      {mode === "create" ? (
        <label className="grid gap-1">
          <span>Estado inicial</span>
          <select className={inputClass} name="status" defaultValue={values?.status ?? "DRAFT"}>
            <option value="DRAFT">Borrador</option>
            <option value="SCHEDULED">Programada</option>
          </select>
        </label>
      ) : null}
      <label className="flex items-center gap-2 md:col-span-2">
        <input name="autoCloseOnFull" type="checkbox" defaultChecked={values?.autoCloseOnFull} />
        Cerrar automáticamente al alcanzar la capacidad
      </label>
      <div className="space-y-2 md:col-span-2">
        <button
          className="rounded bg-zinc-100 px-4 py-2 font-medium text-zinc-950 disabled:opacity-50"
          type="submit"
          disabled={pending}
        >
          {pending ? "Guardando..." : mode === "create" ? "Crear experiencia" : "Guardar cambios"}
        </button>
        {state.message ? (
          <p className={state.ok ? "text-emerald-400" : "text-red-400"} role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
