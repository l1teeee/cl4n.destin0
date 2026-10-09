"use client";

import { useActionState, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { deleteEventImageAction } from "@/app/admin/(protected)/events/actions";
import type { EventImageItem } from "@/application/events/event-image-repository";
import { MAX_EVENT_IMAGES } from "@/contracts/event-image";
import { Alert } from "@/ui/primitives/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/primitives/alert-dialog";
import { Button } from "@/ui/primitives/button";

const decodeError = "No se pudo leer la imagen. Usa una foto JPG, PNG o WebP.";
const uploadErrorFallback = "No se pudo subir la imagen.";
const initialDeleteState = { ok: false, message: "" };

interface PendingUpload {
  id: string;
}

export function createUploadId(): string {
  return crypto.randomUUID();
}

export async function uploadErrorMessage(response: Response): Promise<string> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return uploadErrorFallback;
  }
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : uploadErrorFallback;
  } catch {
    return uploadErrorFallback;
  }
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(decodeError);
  }

  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(decodeError);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const webp = await canvasBlob(canvas, "image/webp", 0.82);
    if (webp?.type === "image/webp") return webp;
    const jpeg = await canvasBlob(canvas, "image/jpeg", 0.85);
    if (!jpeg) throw new Error(decodeError);
    return jpeg;
  } finally {
    bitmap.close();
  }
}

function DeleteImageButton({ eventId, imageId }: { eventId: string; imageId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (previousState: typeof initialDeleteState, formData: FormData) => {
      const result = await deleteEventImageAction(eventId, imageId, previousState, formData);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    initialDeleteState,
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="icon-sm" aria-label="Eliminar imagen">
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar imagen</AlertDialogTitle>
          <AlertDialogDescription>¿Eliminar esta imagen?</AlertDialogDescription>
        </AlertDialogHeader>
        <form action={action} className="grid gap-4">
          {!state.ok && state.message ? <Alert variant="destructive">{state.message}</Alert> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {pending ? "Eliminando..." : "Eliminar"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function EventImagesManager({
  eventId,
  images,
}: {
  eventId: string;
  images: EventImageItem[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<PendingUpload[]>([]);
  const [error, setError] = useState("");
  const freeSlots = MAX_EVENT_IMAGES - images.length;

  async function upload(files: FileList | null): Promise<void> {
    if (!files) return;
    const selected = Array.from(files).slice(0, freeSlots);
    setError("");
    for (const file of selected) {
      const uploadId = createUploadId();
      setUploading((current) => [...current, { id: uploadId }]);
      try {
        const blob = await prepareImage(file);
        const formData = new FormData();
        formData.set("image", blob, file.name);
        const response = await fetch(`/admin/events/${eventId}/images`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error(await uploadErrorMessage(response));
        router.refresh();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : uploadErrorFallback);
      } finally {
        setUploading((current) => current.filter((upload) => upload.id !== uploadId));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <p className="admin-muted">
        {images.length} de {MAX_EVENT_IMAGES}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image) => {
          const href = `/admin/events/${eventId}/images/${image.id}`;
          return (
            <div key={image.id} className="relative aspect-square border border-border">
              <a href={href} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={href} alt="Lugar de la experiencia" className="size-full object-cover" />
              </a>
              <div className="absolute top-2 right-2">
                <DeleteImageButton eventId={eventId} imageId={image.id} />
              </div>
            </div>
          );
        })}
        {uploading.map((upload) => (
          <div
            key={upload.id}
            className="grid aspect-square place-items-center border border-dashed border-border text-sm text-muted-foreground"
          >
            Subiendo...
          </div>
        ))}
        {freeSlots > 0 && uploading.length === 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="aspect-square h-auto rounded-none border border-dashed border-border"
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus className="size-5" />
            Agregar imagen
          </Button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(event) => void upload(event.target.files)}
      />
      {error ? (
        <Alert variant="destructive" role="status">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
