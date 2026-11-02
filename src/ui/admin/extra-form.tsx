"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { drinkPriceInputValue } from "@/domain/drink/drink-price";
import { useFocusFirstInvalid } from "@/ui/admin/use-focus-first-invalid";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { Switch } from "@/ui/primitives/switch";

interface ExtraValues {
  name: string;
  priceCents: number;
  sortOrder: number;
  isActive: boolean;
}

interface ExtraFormProps {
  mode: "create" | "edit";
  extra?: ExtraValues;
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
}

const initialState: AdminActionState = { ok: false, message: "" };

export function ExtraForm({ mode, extra, action }: ExtraFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<AdminActionState>(initialState);
  const [pending, setPending] = useState(false);

  useFocusFirstInvalid(formRef, state);

  // The form is submitted by hand so a rejected save keeps what the admin typed.
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setState(initialState);
    let result: AdminActionState;
    try {
      result = await action(state, new FormData(event.currentTarget));
    } catch {
      setState({ ok: false, message: "No se pudo guardar el extra." });
      setPending(false);
      return;
    }
    if (result.ok) {
      // Stay pending until the navigation replaces this page, so a second click cannot save twice.
      router.push("/admin/extras");
      router.refresh();
      return;
    }
    setState(result);
    setPending(false);
  }

  const errors = state.fieldErrors;

  return (
    <form
      ref={formRef}
      noValidate
      className="grid max-w-3xl gap-5 md:grid-cols-2"
      onSubmit={(event) => void submit(event)}
    >
      {state.message ? (
        <Alert variant="destructive" className="md:col-span-2">
          {state.message}
        </Alert>
      ) : null}
      <Label className="grid gap-2">
        <span>Nombre</span>
        <Input
          name="name"
          className="text-base"
          defaultValue={extra?.name}
          maxLength={80}
          required
          aria-invalid={Boolean(errors?.name)}
          aria-describedby={errors?.name ? "name-error" : undefined}
        />
        <FieldError id="name-error" message={errors?.name} />
      </Label>
      <Label className="grid gap-2">
        <span>Precio</span>
        <span className="relative block">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
            $
          </span>
          <Input
            className="pl-7 text-base"
            name="price"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={extra ? drinkPriceInputValue(extra.priceCents) : undefined}
            required
            aria-invalid={Boolean(errors?.price)}
            aria-describedby={errors?.price ? "price-error" : undefined}
          />
        </span>
        <FieldError id="price-error" message={errors?.price} />
      </Label>
      <Label className="grid gap-2">
        <span>Orden en la lista (opcional)</span>
        <Input
          name="sortOrder"
          className="text-base"
          type="text"
          inputMode="numeric"
          placeholder="0"
          defaultValue={extra ? String(extra.sortOrder) : undefined}
          aria-invalid={Boolean(errors?.sortOrder)}
          aria-describedby={errors?.sortOrder ? "sortOrder-error" : undefined}
        />
        <FieldError id="sortOrder-error" message={errors?.sortOrder} />
      </Label>
      <div className="flex items-center gap-3 md:col-span-2">
        <Switch
          id="isActive"
          name="isActive"
          defaultChecked={extra?.isActive ?? true}
          aria-label="Disponible para cobrar"
        />
        <Label htmlFor="isActive">Disponible para cobrar</Label>
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Guardando..." : mode === "create" ? "Crear extra" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
