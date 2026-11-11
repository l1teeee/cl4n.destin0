"use client";

import { Upload } from "lucide-react";
import { useState } from "react";

import { IMPORT_FILE_EXTENSIONS, MAX_IMPORT_FILE_BYTES } from "@/contracts/guest-import";
import { cn } from "@/ui/cn";

interface ImportDropzoneProps {
  disabled: boolean;
  onFile: (file: File) => void;
  onReject: (message: string) => void;
}

function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!IMPORT_FILE_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return "Usa un archivo CSV, Excel (.xlsx) o JSON.";
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return "El archivo supera 1 MB.";
  }
  return null;
}

export function ImportDropzone({ disabled, onFile, onReject }: ImportDropzoneProps) {
  const [dragging, setDragging] = useState(false);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = validateFile(file);
    if (problem) {
      onReject(problem);
      return;
    }
    onFile(file);
  }

  return (
    <label
      className={cn(
        "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
        dragging && "border-primary bg-accent",
        disabled && "pointer-events-none opacity-50",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) handleFile(event.dataTransfer.files[0]);
      }}
    >
      <Upload className="size-8 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold">Arrastra aquí tu archivo o haz clic para elegirlo</span>
      <span className="admin-muted text-sm">
        CSV, Excel (.xlsx) o JSON · hasta 1 MB y 200 respuestas
      </span>
      <input
        type="file"
        className="sr-only"
        accept={IMPORT_FILE_EXTENSIONS.join(",")}
        disabled={disabled}
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}
