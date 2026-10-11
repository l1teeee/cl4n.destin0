"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { createAdminEventSchema, readCreateEventFormData } from "@/contracts/admin-event";
import { reconcileMapsLink } from "@/domain/event/event-location";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { DatePicker } from "@/ui/primitives/date-picker";
import { DateTimePicker } from "@/ui/primitives/date-time-picker";
import { FieldError } from "@/ui/primitives/field-error";
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
import { SegmentedControl, SegmentedControlItem } from "@/ui/primitives/segmented-control";
import { Switch } from "@/ui/primitives/switch";
import { Textarea } from "@/ui/primitives/textarea";
import { TimePicker } from "@/ui/primitives/time-picker";

import { useFocusFirstInvalid } from "./use-focus-first-invalid";

const initialState: AdminActionState = { ok: false, message: "" };
const createStepOneFields = new Set([
  "internalName",
  "slug",
  "eventDate",
  "eventTime",
  "capacity",
  "maxPartySize",
  "waitlistCapacity",
  "opensAt",
  "closesAt",
  "status",
  "autoCloseOnFull",
]);

type FieldErrors = AdminActionState["fieldErrors"];

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

interface ExperienceFieldsProps {
  errors: FieldErrors;
  grouped: boolean;
  mode: "create" | "edit";
  slugEditable: boolean;
  values?: EventFormValues;
}

const sectionHeadingClass = "text-xs font-bold tracking-[0.2em] uppercase md:col-span-2";

function ExperienceFields({ errors, grouped, mode, slugEditable, values }: ExperienceFieldsProps) {
  return (
    <>
      {grouped ? <h3 className={sectionHeadingClass}>Datos</h3> : null}
      <Label className="grid gap-2">
        <span>Nombre interno</span>
        <Input
          name="internalName"
          defaultValue={values?.internalName}
          maxLength={120}
          required
          aria-invalid={Boolean(errors?.internalName)}
          aria-describedby={errors?.internalName ? "internalName-error" : undefined}
        />
        <FieldError id="internalName-error" message={errors?.internalName} />
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
          aria-invalid={Boolean(errors?.slug)}
          aria-describedby={errors?.slug ? "slug-error" : undefined}
        />
        <FieldError id="slug-error" message={errors?.slug} />
      </div>
      {grouped ? (
        <h3 className={`${sectionHeadingClass} border-t border-border pt-5`}>Fecha</h3>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="eventDate">Fecha del evento</Label>
        <DatePicker
          id="eventDate"
          name="eventDate"
          defaultValue={values?.eventDate}
          invalid={Boolean(errors?.eventDate)}
          describedBy={errors?.eventDate ? "eventDate-error" : undefined}
        />
        <FieldError id="eventDate-error" message={errors?.eventDate} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="eventTime">Hora del evento</Label>
        <TimePicker
          id="eventTime"
          name="eventTime"
          defaultValue={values?.eventTime}
          invalid={Boolean(errors?.eventTime)}
          describedBy={errors?.eventTime ? "eventTime-error" : undefined}
        />
        <FieldError id="eventTime-error" message={errors?.eventTime} />
      </div>
      {grouped ? (
        <h3 className={`${sectionHeadingClass} border-t border-border pt-5`}>Cupos</h3>
      ) : null}
      {mode === "create" ? (
        <Label className="grid gap-2">
          <span>Capacidad total</span>
          <Input
            name="capacity"
            type="number"
            min={1}
            defaultValue={values?.capacity}
            required
            aria-invalid={Boolean(errors?.capacity)}
            aria-describedby={errors?.capacity ? "capacity-error" : undefined}
          />
          <FieldError id="capacity-error" message={errors?.capacity} />
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
          aria-invalid={Boolean(errors?.maxPartySize)}
          aria-describedby={errors?.maxPartySize ? "maxPartySize-error" : undefined}
        />
        <FieldError id="maxPartySize-error" message={errors?.maxPartySize} />
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
            aria-invalid={Boolean(errors?.waitlistCapacity)}
            aria-describedby={errors?.waitlistCapacity ? "waitlistCapacity-error" : undefined}
          />
          <FieldError id="waitlistCapacity-error" message={errors?.waitlistCapacity} />
          <span className="admin-muted">0 desactiva la cola.</span>
        </Label>
      ) : null}
      {grouped ? (
        <h3 className={`${sectionHeadingClass} border-t border-border pt-5`}>Reservaciones</h3>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="opensAt">Apertura</Label>
        <DateTimePicker
          id="opensAt"
          name="opensAt"
          defaultValue={values?.opensAt}
          todayShortcut
          invalid={Boolean(errors?.opensAt)}
          describedBy={errors?.opensAt ? "opensAt-error" : undefined}
        />
        <FieldError id="opensAt-error" message={errors?.opensAt} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="closesAt">Cierre</Label>
        <DateTimePicker
          id="closesAt"
          name="closesAt"
          defaultValue={values?.closesAt}
          invalid={Boolean(errors?.closesAt)}
          describedBy={errors?.closesAt ? "closesAt-error" : undefined}
        />
        <FieldError id="closesAt-error" message={errors?.closesAt} />
      </div>
      {mode === "create" ? (
        <div className="grid gap-2">
          <Label htmlFor="status">Estado inicial</Label>
          <Select name="status" defaultValue={values?.status ?? "DRAFT"}>
            <SelectTrigger
              id="status"
              aria-invalid={Boolean(errors?.status)}
              aria-describedby={errors?.status ? "status-error" : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">Borrador</SelectItem>
              <SelectItem value="SCHEDULED">Programada</SelectItem>
            </SelectContent>
          </Select>
          <FieldError id="status-error" message={errors?.status} />
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
    </>
  );
}

interface LocationFieldsProps {
  errors: FieldErrors;
  mapsLinkWillBeCleared: boolean;
  mode: "create" | "edit";
  setAddress: (value: string) => void;
  setMapsUrl: (value: string) => void;
  values?: EventFormValues;
}

function LocationFields({
  errors,
  mapsLinkWillBeCleared,
  mode,
  setAddress,
  setMapsUrl,
  values,
}: LocationFieldsProps) {
  return (
    <>
      <h2 className={sectionHeadingClass}>Ubicación</h2>
      <div className="grid gap-2">
        <Label htmlFor="locationName">Nombre del lugar</Label>
        <Input
          id="locationName"
          name="locationName"
          defaultValue={values?.locationName ?? ""}
          maxLength={120}
          aria-invalid={Boolean(errors?.locationName)}
          aria-describedby={errors?.locationName ? "locationName-error" : undefined}
        />
        <FieldError id="locationName-error" message={errors?.locationName} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="locationAddress">Dirección</Label>
        <Textarea
          id="locationAddress"
          name="locationAddress"
          defaultValue={values?.locationAddress ?? ""}
          onChange={(event) => setAddress(event.target.value)}
          maxLength={300}
          aria-invalid={Boolean(errors?.locationAddress)}
          aria-describedby={errors?.locationAddress ? "locationAddress-error" : undefined}
        />
        <FieldError id="locationAddress-error" message={errors?.locationAddress} />
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
          aria-invalid={Boolean(errors?.locationMapsUrl)}
          aria-describedby={errors?.locationMapsUrl ? "locationMapsUrl-error" : undefined}
        />
        <FieldError id="locationMapsUrl-error" message={errors?.locationMapsUrl} />
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
          aria-invalid={Boolean(errors?.locationNotes)}
          aria-describedby={errors?.locationNotes ? "locationNotes-error" : undefined}
        />
        <FieldError id="locationNotes-error" message={errors?.locationNotes} />
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
          Márcala como confirmada cuando el lugar sea definitivo. Mientras esté confirmada, cada
          nueva reservación confirmada la recibe por correo. Puedes cambiarla después.
        </p>
        {mode === "create" ? (
          <p className="admin-muted">
            Las imágenes del lugar se agregan después de crear la experiencia, desde Editar.
          </p>
        ) : null}
      </div>
    </>
  );
}

function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    form?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid]')?.focus();
  });
}

function scrollToFormTop(form: HTMLFormElement | null) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  form?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

export function EventForm({ action, values, mode, slugEditable = true }: EventFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [state, formAction, pending] = useActionState(
    async (previousState: AdminActionState, formData: FormData) => {
      const result = await action(previousState, formData);
      if (mode === "create" && !result.ok && result.fieldErrors) {
        const hasStepOneError = Object.keys(result.fieldErrors).some((field) =>
          createStepOneFields.has(field),
        );
        if (hasStepOneError) setStep(1);
        focusFirstInvalid(formRef.current);
      }
      return result;
    },
    initialState,
  );
  const [clientErrors, setClientErrors] = useState<FieldErrors>();
  const [address, setAddress] = useState(values?.locationAddress ?? "");
  const [mapsUrl, setMapsUrl] = useState(values?.locationMapsUrl ?? "");
  const errors = { ...state.fieldErrors, ...clientErrors };
  const mapsLinkWillBeCleared =
    mode === "edit" &&
    reconcileMapsLink(
      { address: values?.locationAddress ?? null, mapsUrl: values?.locationMapsUrl ?? null },
      { address: address.trim() === "" ? null : address, mapsUrl: mapsUrl.trim() },
      false,
    ).mapsUrlCleared;

  const goToStep = (nextStep: 1 | 2) => {
    setStep(nextStep);
    scrollToFormTop(formRef.current);
    requestAnimationFrame(() => {
      const field = nextStep === 1 ? "internalName" : "locationName";
      formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
    });
  };

  const goToLocation = () => {
    if (!formRef.current) return;
    const parsed = createAdminEventSchema.safeParse(
      readCreateEventFormData(new FormData(formRef.current)),
    );
    const nextErrors: NonNullable<FieldErrors> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && createStepOneFields.has(field) && !nextErrors[field]) {
          nextErrors[field] = issue.message;
        }
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setClientErrors(nextErrors);
      focusFirstInvalid(formRef.current);
      return;
    }
    setClientErrors(undefined);
    goToStep(2);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "create" && step === 1) {
      goToLocation();
      return;
    }
    setClientErrors(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  useFocusFirstInvalid(formRef, state);

  const locationFields = (
    <LocationFields
      errors={errors}
      mapsLinkWillBeCleared={mapsLinkWillBeCleared}
      mode={mode}
      setAddress={setAddress}
      setMapsUrl={setMapsUrl}
      values={values}
    />
  );

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="grid max-w-3xl gap-5 md:grid-cols-2"
    >
      {mode === "edit" && values?.locationRevision !== undefined ? (
        <>
          <input type="hidden" name="locationRevision" value={values.locationRevision} />
          <input type="hidden" name="locationStatusLoaded" value={values.locationStatus} />
        </>
      ) : null}
      {mode === "create" ? (
        <>
          <div className="grid gap-3 md:col-span-2">
            <p className="text-sm font-medium">Paso {step} de 2</p>
            <ol className="grid grid-cols-2 gap-2" aria-label="Progreso de creación">
              <li>
                <button
                  type="button"
                  onClick={step === 2 ? () => goToStep(1) : undefined}
                  aria-current={step === 1 ? "step" : undefined}
                  className="flex w-full items-center gap-2 border-b border-primary pb-2 text-left text-sm font-medium"
                >
                  <span className="flex size-6 items-center justify-center rounded-full border border-current text-xs">
                    {step === 2 ? <Check className="size-3" aria-hidden="true" /> : "1"}
                  </span>
                  Experiencia
                </button>
              </li>
              <li>
                <span
                  aria-current={step === 2 ? "step" : undefined}
                  className={`flex items-center gap-2 border-b pb-2 text-sm font-medium ${
                    step === 2
                      ? "border-primary text-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <span className="flex size-6 items-center justify-center rounded-full border border-current text-xs">
                    2
                  </span>
                  Ubicación
                </span>
              </li>
            </ol>
          </div>
          <section
            aria-labelledby="experience-step-heading"
            hidden={step !== 1}
            className="grid gap-5 duration-200 animate-in fade-in-0 motion-reduce:animate-none md:col-span-2 md:grid-cols-2"
          >
            <h2 id="experience-step-heading" className="sr-only">
              Experiencia
            </h2>
            <ExperienceFields
              errors={errors}
              grouped
              mode="create"
              slugEditable={slugEditable}
              values={values}
            />
            {clientErrors ? (
              <Alert variant="destructive" role="status" className="md:col-span-2">
                Revisa los campos marcados.
              </Alert>
            ) : null}
            <div className="md:col-span-2">
              <Button type="button" onClick={goToLocation}>
                Siguiente
              </Button>
            </div>
          </section>
          <section
            aria-label="Ubicación"
            hidden={step !== 2}
            className="grid gap-5 duration-200 animate-in fade-in-0 motion-reduce:animate-none md:col-span-2 md:grid-cols-2"
          >
            {locationFields}
            <div className="space-y-2 md:col-span-2">
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={() => goToStep(1)}>
                  Atrás
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {pending ? "Guardando..." : "Crear experiencia"}
                </Button>
              </div>
              {state.message ? (
                <Alert variant={state.ok ? "success" : "destructive"} role="status">
                  {state.message}
                </Alert>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <>
          <ExperienceFields
            errors={errors}
            grouped={false}
            mode="edit"
            slugEditable={slugEditable}
            values={values}
          />
          <section className="grid gap-5 border-t border-border pt-5 md:col-span-2 md:grid-cols-2">
            {locationFields}
          </section>
          <div className="space-y-2 md:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {pending ? "Guardando..." : "Guardar cambios"}
            </Button>
            {state.message ? (
              <Alert variant={state.ok ? "success" : "destructive"} role="status">
                {state.message}
              </Alert>
            ) : null}
          </div>
        </>
      )}
    </form>
  );
}
