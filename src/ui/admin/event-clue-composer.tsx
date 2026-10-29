"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";
import { Textarea } from "@/ui/primitives/textarea";
import { prepareImage } from "@/ui/admin/prepare-image";

const MAX_IMAGES = 3;
const MAX_IMAGE_SIZE = 1_048_576;

interface EventClueComposerProps {
  eventId: string;
}

interface PreparedClueImage {
  blob: Blob;
  previewUrl: string;
}

export function EventClueComposer({ eventId }: EventClueComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [images, setImages] = useState<PreparedClueImage[]>([]);
  const previewUrls = useRef<string[]>([]);
  const imageSelectionVersion = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preparingImages, setPreparingImages] = useState(false);

  useEffect(
    () => () => {
      imageSelectionVersion.current += 1;
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  function clearPreviews() {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current = [];
  }

  async function selectImages(files: FileList | null) {
    const selectionVersion = ++imageSelectionVersion.current;
    clearPreviews();
    setImages([]);
    const selected = Array.from(files ?? []);
    if (selected.length > MAX_IMAGES) {
      setPreparingImages(false);
      setError("Puedes adjuntar hasta 3 imágenes.");
      return;
    }
    if (selected.some((image) => !image.type.startsWith("image/"))) {
      setPreparingImages(false);
      setError("Selecciona archivos de imagen.");
      return;
    }
    if (selected.length === 0) {
      setPreparingImages(false);
      setError(null);
      return;
    }
    setPreparingImages(true);
    try {
      const prepared = await Promise.all(selected.map(async (file) => prepareImage(file)));
      if (selectionVersion !== imageSelectionVersion.current) return;
      if (prepared.some((image) => image.size > MAX_IMAGE_SIZE)) {
        setError("Una imagen sigue pesando más de 1 MB después de optimizarla.");
        return;
      }
      const withPreviews = prepared.map((blob) => ({
        blob,
        previewUrl: URL.createObjectURL(blob),
      }));
      previewUrls.current = withPreviews.map((image) => image.previewUrl);
      setImages(withPreviews);
      setError(null);
    } catch (imageError) {
      if (selectionVersion !== imageSelectionVersion.current) return;
      setError(
        imageError instanceof Error ? imageError.message : "No se pudieron preparar las imágenes.",
      );
    } finally {
      if (selectionVersion === imageSelectionVersion.current) setPreparingImages(false);
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setPending(true);

    try {
      const formData = new FormData();
      formData.set("body", body);
      images.forEach((image) => formData.append("images", image.blob, "pista.webp"));
      const response = await fetch(`/admin/events/${encodeURIComponent(eventId)}/clues`, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
        cache: "no-store",
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "No se pudo publicar la pista. Inténtalo de nuevo.";
        setError(message);
        return;
      }
      setBody("");
      clearPreviews();
      setImages([]);
      setStatus("Pista publicada.");
      router.refresh();
    } catch {
      setError(
        "No se pudo conectar para publicar la pista. Revisa tu conexión e inténtalo de nuevo.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={publish}>
      <Label className="grid gap-2">
        <span>Pista</span>
        <Textarea
          name="body"
          rows={4}
          maxLength={500}
          required
          disabled={pending}
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
        />
      </Label>
      <Label className="grid gap-2">
        <span>Imágenes (opcional, hasta 3; máximo 1 MB cada una)</span>
        <input
          className="block w-full min-w-0 text-sm text-foreground file:mr-3 file:min-h-11 file:border-0 file:bg-transparent file:px-3 file:text-sm file:font-semibold file:text-foreground"
          type="file"
          accept="image/*"
          multiple
          disabled={pending}
          onChange={(event) => {
            void selectImages(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </Label>
      {body.trim() || images.length > 0 ? (
        <section
          className="grid min-w-0 gap-3 rounded-lg border border-border p-4 sm:p-5"
          aria-labelledby="clue-draft-preview-title"
        >
          <h3 id="clue-draft-preview-title" className="admin-section-title text-base">
            Vista previa de la pista
          </h3>
          {body.trim() ? (
            <p className="whitespace-pre-line break-words text-lg leading-relaxed">{body}</p>
          ) : null}
          {images.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Imágenes de la pista">
              {images.map((image, index) => (
                <li key={image.previewUrl} className="min-w-0">
                  {/* Local previews are created only from files selected by the admin. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="aspect-square w-full rounded-md object-cover"
                    src={image.previewUrl}
                    alt={`Vista previa de imagen ${index + 1}`}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
      <Button type="submit" disabled={pending || preparingImages || !body.trim()}>
        {pending ? "Publicando..." : preparingImages ? "Preparando imágenes..." : "Generar pista"}
      </Button>
    </form>
  );
}
