"use client";

import { startTransition, useActionState, useRef, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { ACCOUNT_TYPES, type PaymentSettings } from "@/domain/payment/payment-settings";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";

import { useFocusFirstInvalid } from "./use-focus-first-invalid";

type PaymentSettingsAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

const initialState: AdminActionState = { ok: false, message: "" };

interface PaymentSettingsFormProps {
  action: PaymentSettingsAction;
  settings: PaymentSettings | null;
}

interface TextFieldProps {
  name: string;
  label: string;
  defaultValue: string | undefined;
  error: string | undefined;
  maxLength: number;
  hint?: string;
  required?: boolean;
}

function TextField({
  name,
  label,
  defaultValue,
  error,
  maxLength,
  hint,
  required,
}: TextFieldProps) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy || undefined}
      />
      <FieldError id={errorId} message={error} />
      {hint ? (
        <p id={hintId} className="admin-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function PaymentSettingsForm({ action, settings }: PaymentSettingsFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, state);
  const errors = state.fieldErrors;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="grid max-w-xl gap-4 md:grid-cols-2"
    >
      <TextField
        name="bankName"
        label="Banco"
        defaultValue={settings?.bankName}
        error={errors?.bankName}
        maxLength={80}
        required
      />
      <div className="grid gap-2">
        <Label htmlFor="accountType">Tipo de cuenta</Label>
        <Select name="accountType" defaultValue={settings?.accountType ?? ACCOUNT_TYPES[0]}>
          <SelectTrigger
            id="accountType"
            aria-invalid={Boolean(errors?.accountType)}
            aria-describedby={errors?.accountType ? "accountType-error" : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError id="accountType-error" message={errors?.accountType} />
      </div>
      <TextField
        name="accountNumber"
        label="Número de cuenta"
        defaultValue={settings?.accountNumber}
        error={errors?.accountNumber}
        maxLength={80}
        required
      />
      <TextField
        name="accountHolder"
        label="Titular"
        defaultValue={settings?.accountHolder}
        error={errors?.accountHolder}
        maxLength={80}
        required
      />
      <div className="md:col-span-2">
        <TextField
          name="paymentLink"
          label="Enlace o código de pago (opcional)"
          defaultValue={settings?.paymentLink ?? undefined}
          error={errors?.paymentLink}
          maxLength={300}
          hint="El enlace o código que te da la app del banco"
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Guardando..." : "Guardar"}
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
