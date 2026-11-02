"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

import { IDLE_ACTION_STATE } from "./economy-handlers";

interface CustomItemFormProps {
  pending: boolean;
  disabled: boolean;
  onSubmit: (formData: FormData) => Promise<AdminActionState>;
}

export function CustomItemForm({ pending, disabled, onSubmit }: CustomItemFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<AdminActionState>(IDLE_ACTION_STATE);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("source", "CUSTOM");
    const result = await onSubmit(formData);
    setState(result);
    if (result.ok) formRef.current?.reset();
  }

  const errors = state.fieldErrors;

  return (
    <form
      ref={formRef}
      noValidate
      className="grid gap-3"
      aria-label="Otro consumo"
      onSubmit={(event) => void submit(event)}
    >
      <Label className="grid gap-2">
        <span>Nombre</span>
        <Input
          name="customName"
          className="text-base"
          maxLength={80}
          autoComplete="off"
          aria-invalid={Boolean(errors?.customName)}
          aria-describedby={errors?.customName ? "custom-name-error" : undefined}
        />
        <FieldError id="custom-name-error" message={errors?.customName} />
      </Label>
      <div className="grid grid-cols-2 gap-3">
        <Label className="grid gap-2">
          <span>Precio</span>
          <span className="relative block">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
              $
            </span>
            <Input
              name="customPrice"
              className="pl-7 text-base"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              autoComplete="off"
              aria-invalid={Boolean(errors?.customPrice)}
              aria-describedby={errors?.customPrice ? "custom-price-error" : undefined}
            />
          </span>
          <FieldError id="custom-price-error" message={errors?.customPrice} />
        </Label>
        <Label className="grid gap-2">
          <span>Cantidad</span>
          <Input
            name="quantity"
            className="text-base"
            type="text"
            inputMode="numeric"
            defaultValue="1"
            autoComplete="off"
            aria-invalid={Boolean(errors?.quantity)}
            aria-describedby={errors?.quantity ? "custom-quantity-error" : undefined}
          />
          <FieldError id="custom-quantity-error" message={errors?.quantity} />
        </Label>
      </div>
      <Button type="submit" variant="outline" disabled={disabled}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Agregar consumo
      </Button>
    </form>
  );
}
