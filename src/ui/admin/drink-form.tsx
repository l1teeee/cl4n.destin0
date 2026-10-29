"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { drinkPriceInputValue } from "@/domain/drink/drink-price";
import { prepareImage } from "@/ui/admin/prepare-image";
import { useFocusFirstInvalid } from "@/ui/admin/use-focus-first-invalid";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";
import { Switch } from "@/ui/primitives/switch";
import { Textarea } from "@/ui/primitives/textarea";

interface DrinkValues {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  isVisible: boolean;
  imageId: string | null;
}

interface DrinkFormProps {
  mode: "create" | "edit";
  drink?: DrinkValues;
}

interface DrinkSaveResult {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

const saveError: DrinkSaveResult = { ok: false, message: "No se pudo guardar la bebida." };

export async function readDrinkSaveResponse(response: Response): Promise<DrinkSaveResult> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return saveError;
  }

  try {
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object") return saveError;
    const result = body as Record<string, unknown>;
    if (typeof result.ok !== "boolean" || typeof result.message !== "string") return saveError;
    if (result.id !== undefined && typeof result.id !== "string") return saveError;
    if (result.fieldErrors !== undefined) {
      if (!result.fieldErrors || typeof result.fieldErrors !== "object") return saveError;
      const values = Object.values(result.fieldErrors);
      if (!values.every((value) => typeof value === "string")) return saveError;
    }
    return {
      ok: result.ok,
      message: result.message,
      ...(result.fieldErrors ? { fieldErrors: result.fieldErrors as Record<string, string> } : {}),
      ...(result.id ? { id: result.id } : {}),
    };
  } catch {
    return saveError;
  }
}

export function DrinkForm({ mode, drink }: DrinkFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentImageRemoved, setCurrentImageRemoved] = useState(false);
  const [state, setState] = useState<AdminActionState>({ ok: false, message: "" });
  const [pending, setPending] = useState(false);
  const currentImageUrl =
    drink?.imageId && !currentImageRemoved ? `/bebidas/imagen/${drink.imageId}` : null;
  const displayedImage = previewUrl ?? currentImageUrl;
  const hasImage = selectedFile !== null || currentImageUrl !== null;

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  useFocusFirstInvalid(formRef, state);

  function chooseImage(file: File | undefined): void {
    if (!file) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setSelectedFile(file);
    setCurrentImageRemoved(false);
    setState({ ok: false, message: "" });
  }

  function removeImage(): void {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setSelectedFile(null);
    setCurrentImageRemoved(Boolean(drink?.imageId));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setState({ ok: false, message: "" });

    const formData = new FormData(event.currentTarget);
    if (selectedFile) {
      try {
        const image = await prepareImage(selectedFile);
        formData.set("image", image, "bebida.webp");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "No se pudo leer la imagen. Usa una foto JPG, PNG o WebP.";
        setState({
          ok: false,
          message: "Revisa los campos marcados.",
          fieldErrors: { image: message },
        });
        setPending(false);
        return;
      }
    } else if (currentImageRemoved) {
      formData.set("removeImage", "on");
    }

    const endpoint = mode === "create" ? "/admin/drinks/save" : `/admin/drinks/${drink!.id}/save`;
    try {
      const response = await fetch(endpoint, { method: "POST", body: formData });
      const result = await readDrinkSaveResponse(response);
      if (result.ok) {
        // Stay pending until the navigation replaces this page, so a second click cannot save twice.
        router.push("/admin/drinks");
        router.refresh();
        return;
      }
      setState(result);
    } catch {
      setState(saveError);
    }
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
          defaultValue={drink?.name}
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
            className="pl-7"
            name="price"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={drink ? drinkPriceInputValue(drink.priceCents) : undefined}
            required
            aria-invalid={Boolean(errors?.price)}
            aria-describedby={errors?.price ? "price-error" : undefined}
          />
        </span>
        <FieldError id="price-error" message={errors?.price} />
      </Label>
      <Label className="grid gap-2 md:col-span-2">
        <span>Descripción opcional</span>
        <Textarea
          name="description"
          defaultValue={drink?.description ?? undefined}
          maxLength={280}
          aria-invalid={Boolean(errors?.description)}
          aria-describedby={errors?.description ? "description-error" : undefined}
        />
        <FieldError id="description-error" message={errors?.description} />
      </Label>
      <div className="flex items-center gap-3 md:col-span-2">
        <Switch
          id="isVisible"
          name="isVisible"
          defaultChecked={drink?.isVisible ?? true}
          aria-label="Mostrar en el menú"
        />
        <Label htmlFor="isVisible">Mostrar en el menú</Label>
      </div>
      <div className="grid gap-3 md:col-span-2">
        <Label>Imagen</Label>
        <div className="grid size-48 place-items-center overflow-hidden border border-border text-sm text-muted-foreground">
          {displayedImage ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={displayedImage} alt="" className="size-full object-cover" />
          ) : (
            "Sin imagen"
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            {hasImage ? "Cambiar imagen" : "Elegir imagen"}
          </Button>
          {hasImage ? (
            <Button type="button" variant="destructive" onClick={removeImage}>
              Quitar imagen
            </Button>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-invalid={Boolean(errors?.image)}
          aria-describedby={errors?.image ? "image-error" : undefined}
          onChange={(event) => chooseImage(event.target.files?.[0])}
        />
        <FieldError id="image-error" message={errors?.image} />
      </div>
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Guardando..." : mode === "create" ? "Crear bebida" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
