"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";

interface DrinkDetailsDialogProps {
  children: ReactNode;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  visibility?: "Visible" | "Oculta";
}

export function DrinkDetailsDialog({
  children,
  name,
  description,
  price,
  imageUrl,
  visibility,
}: DrinkDetailsDialogProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#11120d]/80 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-[#2b2c26] bg-[#11120d] p-5 text-[#fffbf4] shadow-xl">
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="break-words text-lg font-semibold">{name}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar detalles"
                className="shrink-0 rounded-full p-1 text-[#8d8b85] hover:text-[#fffbf4] focus-visible:text-[#fffbf4]"
              >
                <X className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={`Imagen de ${name}`}
              className="mt-4 max-h-52 w-full object-contain"
            />
          ) : null}
          <Dialog.Description className="mt-4 text-sm whitespace-pre-line text-[#c9c8c1]">
            {description || "Sin descripción."}
          </Dialog.Description>
          <div className="mt-5 flex items-center justify-between gap-4 border-t border-[#2b2c26] pt-4">
            <span className="font-medium">{price}</span>
            {visibility ? <span className="text-xs text-[#8d8b85]">{visibility}</span> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
