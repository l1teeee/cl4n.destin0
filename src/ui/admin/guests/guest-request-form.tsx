"use client";

import { startTransition, useActionState, useId, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { useFocusFirstInvalid } from "@/ui/admin/use-focus-first-invalid";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { SegmentedControl, SegmentedControlItem } from "@/ui/primitives/segmented-control";
import { Textarea } from "@/ui/primitives/textarea";

type GuestRequestAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export interface GuestRequestFormValues {
  partySize: 1 | 2;
  guest1Name: string;
  guest1Instagram: string;
  guest2Name: string;
  guest2Instagram: string;
  hasAllergies: boolean;
  allergies: string;
  notes: string;
}

interface GuestRequestFormProps {
  action: GuestRequestAction;
  submitLabel: string;
  defaultValues?: Partial<GuestRequestFormValues>;
  allowCouple?: boolean;
}

interface FieldProps {
  id: string;
  name: string;
  label: string;
  defaultValue: string | undefined;
  error: string | undefined;
  maxLength?: number;
}

const initialState: AdminActionState = { ok: false, message: "" };
const legendClassName =
  "mb-2 text-[0.72rem] leading-none tracking-[0.2em] text-[var(--clan-muted)] uppercase opacity-70";

function TextField({ id, name, label, defaultValue, error, maxLength }: FieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        defaultValue={defaultValue}
        maxLength={maxLength}
        autoComplete="off"
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function TextAreaField({
  id,
  name,
  label,
  defaultValue,
  error,
  maxLength,
  required = false,
}: FieldProps & { required?: boolean }) {
  const errorId = `${id}-error`;

  return (
    <div className="grid gap-2 md:col-span-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        name={name}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

// The action receives partySize as "1" or "2" and hasAllergies as "true" or "false".
export function GuestRequestForm({
  action,
  submitLabel,
  defaultValues,
  allowCouple = true,
}: GuestRequestFormProps) {
  const idPrefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [partySize, setPartySize] = useState<1 | 2>(
    allowCouple ? (defaultValues?.partySize ?? 1) : 1,
  );
  const [hasAllergies, setHasAllergies] = useState<boolean | null>(
    defaultValues?.hasAllergies ?? null,
  );
  const errors = state.fieldErrors;
  const couple = partySize === 2;
  const idFor = (field: string) => `${idPrefix}-${field}`;

  useFocusFirstInvalid(formRef, state);

  // Submitting through an action prop would make React reset every typed value after a failed save.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="grid max-w-3xl gap-5 md:grid-cols-2"
    >
      {allowCouple ? (
        <div className="grid gap-2 md:col-span-2">
          <SegmentedControl
            name="partySize"
            value={String(partySize)}
            onValueChange={(value) => setPartySize(value === "2" ? 2 : 1)}
            aria-label="Cantidad de personas"
            aria-invalid={Boolean(errors?.partySize)}
            aria-describedby={errors?.partySize ? idFor("partySize-error") : undefined}
          >
            <SegmentedControlItem value="1">Solo</SegmentedControlItem>
            <SegmentedControlItem value="2">En pareja</SegmentedControlItem>
          </SegmentedControl>
          <FieldError id={idFor("partySize-error")} message={errors?.partySize} />
        </div>
      ) : (
        <input type="hidden" name="partySize" value="1" />
      )}
      <TextField
        id={idFor("guest1Name")}
        name="guest1Name"
        label={couple ? "Persona 1: nombre completo" : "Nombre completo"}
        defaultValue={defaultValues?.guest1Name}
        error={errors?.guest1Name}
        maxLength={120}
      />
      <TextField
        id={idFor("guest1Instagram")}
        name="guest1Instagram"
        label={couple ? "Persona 1: usuario de Instagram" : "Usuario de Instagram"}
        defaultValue={defaultValues?.guest1Instagram}
        error={errors?.guest1Instagram}
      />
      {couple ? (
        <>
          <TextField
            id={idFor("guest2Name")}
            name="guest2Name"
            label="Persona 2: nombre completo"
            defaultValue={defaultValues?.guest2Name}
            error={errors?.guest2Name}
            maxLength={120}
          />
          <TextField
            id={idFor("guest2Instagram")}
            name="guest2Instagram"
            label="Persona 2: usuario de Instagram"
            defaultValue={defaultValues?.guest2Instagram}
            error={errors?.guest2Instagram}
          />
        </>
      ) : null}
      <fieldset className="min-w-0 md:col-span-2">
        <legend id={idFor("hasAllergies-legend")} className={legendClassName}>
          {couple ? "¿Alguno de los dos tiene alergias?" : "¿Tiene alergias?"}
        </legend>
        <div className="grid gap-2">
          <SegmentedControl
            name="hasAllergies"
            value={hasAllergies === null ? "" : String(hasAllergies)}
            onValueChange={(value) => setHasAllergies(value === "true")}
            required
            aria-labelledby={idFor("hasAllergies-legend")}
            aria-invalid={Boolean(errors?.hasAllergies)}
            aria-describedby={errors?.hasAllergies ? idFor("hasAllergies-error") : undefined}
          >
            <SegmentedControlItem value="false">No</SegmentedControlItem>
            <SegmentedControlItem value="true">Sí</SegmentedControlItem>
          </SegmentedControl>
          <FieldError id={idFor("hasAllergies-error")} message={errors?.hasAllergies} />
        </div>
      </fieldset>
      {hasAllergies ? (
        <TextAreaField
          id={idFor("allergies")}
          name="allergies"
          label={couple ? "¿Quién y a qué?" : "¿A qué?"}
          defaultValue={defaultValues?.allergies}
          error={errors?.allergies}
          maxLength={300}
          required
        />
      ) : null}
      <TextAreaField
        id={idFor("notes")}
        name="notes"
        label="Observaciones (opcional)"
        defaultValue={defaultValues?.notes}
        error={errors?.notes}
      />
      <div className="space-y-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Guardando..." : submitLabel}
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
