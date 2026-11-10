"use client";

import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Check, Loader2 } from "lucide-react";
import Link from "next/link";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { createAdminEventSchema, readCreateEventFormData } from "@/contracts/admin-event";
import { drinkPriceInputValue, parseDrinkPriceCents } from "@/domain/drink/drink-price";
import { reconcileMapsLink } from "@/domain/event/event-location";
import { mapProviderOf } from "@/domain/event/map-links";
import type { PaymentSettings } from "@/domain/payment/payment-settings";
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

import { ElSalvadorClock } from "./el-salvador-clock";
import { PaymentPreview } from "./payment-preview";
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
  "price",
  "paymentInstructions",
]);
const sectionHints = {
  data: "Nombre y enlace público de la experiencia.",
  date: "Día y hora de la cena, en hora de El Salvador.",
  seats:
    "Capacidad: lugares totales. Personas por solicitud: 1 solo individuales, 2 también parejas. Cola: cuántas personas pueden esperar si se llena.",
  reservations: "Cuándo se abre y se cierra el formulario público para pedir lugar.",
  location: "Se envía por Instagram solo a las personas confirmadas.",
};
const paymentHint = (
  <>
    Precio por persona. Los datos bancarios se configuran una vez en{" "}
    <Link
      href="/admin/account#datos-de-pago"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-4 transition-opacity duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-60"
    >
      Mi cuenta &gt; Datos de pago<span className="sr-only"> (se abre en una pestaña nueva)</span>
    </Link>
    .
  </>
);
const opensAtHint = "Desde esta hora la gente puede enviar solicitudes.";
const closesAtHint =
  "Después de esta hora ya no se aceptan solicitudes. Debe ser antes de la cena.";
const statusHint =
  "Borrador: no se ve en el sitio. Programada: se publica y se abre sola a la hora de apertura.";
const openNowActiveHint = "Se abrirá en cuanto guardes.";

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
  paymentInstructions?: string | null;
  priceCents?: number | null;
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
  paymentSettings: PaymentSettings | null;
  values?: EventFormValues;
  mode: "create" | "edit";
  slugEditable?: boolean;
  // Current El Salvador time rounded up to the next minute; only used when creating.
  suggestedOpensAt?: string;
}

interface ExperienceFieldsProps {
  errors: FieldErrors;
  paymentSettings: PaymentSettings | null;
  mode: "create" | "edit";
  slugEditable: boolean;
  suggestedOpensAt?: string;
  values?: EventFormValues;
}

const sectionHeadingClass = "text-xs font-bold tracking-[0.2em] uppercase";
const separatedSectionClass = "grid gap-2 border-t border-border pt-5 md:col-span-2";

interface SectionHeadingProps {
  title: string;
  hint: ReactNode;
  as?: "h2" | "h3";
  separated?: boolean;
  aside?: ReactNode;
}

function SectionHeading({
  title,
  hint,
  as: Heading = "h3",
  separated = true,
  aside,
}: SectionHeadingProps) {
  return (
    <div className={separated ? separatedSectionClass : "grid gap-2 md:col-span-2"}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading className={sectionHeadingClass}>{title}</Heading>
        {aside}
      </div>
      <p className="admin-muted">{hint}</p>
    </div>
  );
}

function ExperienceFields({
  errors,
  paymentSettings,
  mode,
  slugEditable,
  suggestedOpensAt,
  values,
}: ExperienceFieldsProps) {
  const [openNow, setOpenNow] = useState(false);
  const [priceText, setPriceText] = useState(
    values?.priceCents == null ? "" : drinkPriceInputValue(values.priceCents),
  );
  const [paymentNote, setPaymentNote] = useState(values?.paymentInstructions ?? "");

  return (
    <>
      <SectionHeading title="Datos" hint={sectionHints.data} separated={false} />
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
      <SectionHeading title="Fecha" hint={sectionHints.date} />
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
      <SectionHeading title="Cupos" hint={sectionHints.seats} />
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
      <div className="grid gap-2">
        <Label htmlFor="maxPartySize">Personas por solicitud</Label>
        {/* Events saved before couples existed can hold a larger group; the select shows couples. */}
        <Select name="maxPartySize" defaultValue={values?.maxPartySize === 1 ? "1" : "2"}>
          <SelectTrigger
            id="maxPartySize"
            aria-invalid={Boolean(errors?.maxPartySize)}
            aria-describedby={errors?.maxPartySize ? "maxPartySize-error" : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Solo personas individuales</SelectItem>
            <SelectItem value="2">Individuales y parejas</SelectItem>
          </SelectContent>
        </Select>
        <FieldError id="maxPartySize-error" message={errors?.maxPartySize} />
      </div>
      {mode === "create" ? (
        <Label className="grid gap-2">
          <span>Lugares en la cola</span>
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
      <SectionHeading
        title="Reservaciones"
        hint={sectionHints.reservations}
        aside={<ElSalvadorClock />}
      />
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="opensAt">Apertura</Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={openNow}
            onClick={() => setOpenNow((current) => !current)}
          >
            Abrir ahora
          </Button>
        </div>
        <DateTimePicker
          id="opensAt"
          name="opensAt"
          defaultValue={values?.opensAt ?? suggestedOpensAt}
          todayShortcut
          invalid={Boolean(errors?.opensAt)}
          describedBy={errors?.opensAt ? "opensAt-error opensAt-hint" : "opensAt-hint"}
        />
        {openNow ? <input type="hidden" name="openNow" value="1" /> : null}
        <FieldError id="opensAt-error" message={errors?.opensAt} />
        <p id="opensAt-hint" className="admin-muted">
          {openNow ? openNowActiveHint : opensAtHint}
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="closesAt">Cierre</Label>
        <DateTimePicker
          id="closesAt"
          name="closesAt"
          defaultValue={values?.closesAt}
          invalid={Boolean(errors?.closesAt)}
          describedBy={errors?.closesAt ? "closesAt-error closesAt-hint" : "closesAt-hint"}
        />
        <FieldError id="closesAt-error" message={errors?.closesAt} />
        <p id="closesAt-hint" className="admin-muted">
          {closesAtHint}
        </p>
      </div>
      {mode === "create" ? (
        <div className="grid gap-2">
          <Label htmlFor="status">Estado inicial</Label>
          <Select name="status" defaultValue={values?.status ?? "DRAFT"}>
            <SelectTrigger
              id="status"
              aria-invalid={Boolean(errors?.status)}
              aria-describedby={errors?.status ? "status-error status-hint" : "status-hint"}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">Borrador</SelectItem>
              <SelectItem value="SCHEDULED">Programada</SelectItem>
            </SelectContent>
          </Select>
          <FieldError id="status-error" message={errors?.status} />
          <p id="status-hint" className="admin-muted">
            {statusHint}
          </p>
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
      <SectionHeading title="Pago" hint={paymentHint} />
      <Label className="grid gap-2">
        <span>Precio por persona (USD)</span>
        <span className="relative block">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
            $
          </span>
          <Input
            className="pl-7"
            name="price"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={
              values?.priceCents == null ? undefined : drinkPriceInputValue(values.priceCents)
            }
            onChange={(event) => setPriceText(event.target.value)}
            required={mode === "create" || values?.priceCents != null}
            aria-invalid={Boolean(errors?.price)}
            aria-describedby={errors?.price ? "price-error" : undefined}
          />
        </span>
        <FieldError id="price-error" message={errors?.price} />
      </Label>
      <div className="grid gap-2 md:col-span-2">
        <Label htmlFor="paymentInstructions">Nota de pago (opcional)</Label>
        <Textarea
          id="paymentInstructions"
          name="paymentInstructions"
          defaultValue={values?.paymentInstructions ?? ""}
          onChange={(event) => setPaymentNote(event.target.value)}
          maxLength={600}
          rows={2}
          placeholder="Paga antes del jueves"
          aria-invalid={Boolean(errors?.paymentInstructions)}
          aria-describedby={errors?.paymentInstructions ? "paymentInstructions-error" : undefined}
        />
        <FieldError id="paymentInstructions-error" message={errors?.paymentInstructions} />
        <PaymentPreview
          settings={paymentSettings}
          priceCents={parseDrinkPriceCents(priceText)}
          note={paymentNote}
        />
      </div>
    </>
  );
}

interface LocationFieldsProps {
  errors: FieldErrors;
  mapsLinkWillBeCleared: boolean;
  mapsUrl: string;
  mode: "create" | "edit";
  setAddress: (value: string) => void;
  setMapsUrl: (value: string) => void;
  values?: EventFormValues;
}

function detectedLinkText(value: string): string | null {
  const link = value.trim();
  if (link === "") return null;
  const provider = mapProviderOf(link);
  if (provider === "GOOGLE_MAPS") return "Enlace de Google Maps detectado.";
  if (provider === "WAZE") return "Enlace de Waze detectado.";
  return "Este enlace no es de Google Maps ni de Waze.";
}

function LocationFields({
  errors,
  mapsLinkWillBeCleared,
  mapsUrl,
  mode,
  setAddress,
  setMapsUrl,
  values,
}: LocationFieldsProps) {
  const detectedLinkMessage = detectedLinkText(mapsUrl);
  return (
    <>
      <SectionHeading title="Ubicación" hint={sectionHints.location} as="h2" separated={false} />
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
          <Label htmlFor="locationMapsUrl">Enlace de ubicación (Google Maps o Waze)</Label>
          <FieldHint label="Cómo obtener el enlace">
            Abre el lugar en Google Maps o Waze, toca Compartir y copia el enlace.
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
        {detectedLinkMessage ? <p className="admin-muted">{detectedLinkMessage}</p> : null}
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
          nueva reservación confirmada la recibe por DM de Instagram. Puedes cambiarla después.
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

export function EventForm({
  action,
  paymentSettings,
  values,
  mode,
  slugEditable = true,
  suggestedOpensAt,
}: EventFormProps) {
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
      mapsUrl={mapsUrl}
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
              paymentSettings={paymentSettings}
              mode="create"
              slugEditable={slugEditable}
              suggestedOpensAt={suggestedOpensAt}
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
            paymentSettings={paymentSettings}
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
