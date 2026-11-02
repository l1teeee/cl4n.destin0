"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";

interface MessageImagesProps {
  srcs: readonly string[];
  username: string | null;
}

const navigationButtonClassName =
  "inline-flex size-11 items-center justify-center rounded-full text-[#fffbf4] transition-opacity duration-200 hover:opacity-60 focus-visible:opacity-60 disabled:pointer-events-none disabled:opacity-30";

function imageAlt(username: string | null): string {
  return username ? `Imagen enviada por ${username}` : "Imagen enviada";
}

export function MessageImages({ srcs, username }: MessageImagesProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const openedFrom = useRef<HTMLButtonElement | null>(null);

  if (srcs.length === 0) return null;

  const alt = imageAlt(username);
  const activeSrc = activeIndex === null ? undefined : srcs[activeIndex];
  const hasPrevious = activeIndex !== null && activeIndex > 0;
  const hasNext = activeIndex !== null && activeIndex < srcs.length - 1;

  function showImageAt(offset: number) {
    if (activeIndex === null) return;
    const index = activeIndex + offset;
    if (index >= 0 && index < srcs.length) setActiveIndex(index);
  }

  function navigateWithArrows(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") showImageAt(-1);
    if (event.key === "ArrowRight") showImageAt(1);
  }

  return (
    <>
      <ul aria-label="Imágenes del mensaje" className="grid w-max grid-cols-2 gap-1.5">
        {srcs.map((src, index) => (
          <li key={src}>
            <button
              type="button"
              aria-label={`Ampliar imagen ${index + 1} de ${srcs.length}`}
              className="block size-24 overflow-hidden rounded-[14px] border border-border"
              onClick={(event) => {
                openedFrom.current = event.currentTarget;
                setActiveIndex(index);
              }}
            >
              {/* Message images come from an authenticated same-origin route, so next/image adds nothing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={alt} loading="lazy" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Dialog.Root
        open={activeSrc !== undefined}
        onOpenChange={(open) => {
          if (!open) setActiveIndex(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/85 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content
            aria-describedby={undefined}
            onKeyDown={navigateWithArrows}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              openedFrom.current?.focus();
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) setActiveIndex(null);
            }}
            className="fixed inset-0 z-50 grid place-content-center justify-items-center gap-3 text-[#fffbf4] outline-none"
          >
            <Dialog.Title className="sr-only">
              {activeIndex === null ? alt : `${alt} (${activeIndex + 1} de ${srcs.length})`}
            </Dialog.Title>
            {activeSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeSrc} alt={alt} className="max-h-[85vh] max-w-[90vw] object-contain" />
            ) : null}
            <div className="flex items-center gap-2">
              {srcs.length > 1 ? (
                <button
                  type="button"
                  aria-label="Imagen anterior"
                  disabled={!hasPrevious}
                  className={navigationButtonClassName}
                  onClick={() => showImageAt(-1)}
                >
                  <ChevronLeft aria-hidden="true" className="size-5" />
                </button>
              ) : null}
              {activeSrc ? (
                <a
                  href={activeSrc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center px-3 text-sm underline underline-offset-4 transition-opacity duration-200 [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-60"
                >
                  Abrir original
                </a>
              ) : null}
              {srcs.length > 1 ? (
                <button
                  type="button"
                  aria-label="Imagen siguiente"
                  disabled={!hasNext}
                  className={navigationButtonClassName}
                  onClick={() => showImageAt(1)}
                >
                  <ChevronRight aria-hidden="true" className="size-5" />
                </button>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar imagen"
                className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-full transition-opacity duration-200 hover:opacity-60 focus-visible:opacity-60"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
