"use client";

import { ChevronDown } from "lucide-react";

import { Label } from "@/ui/primitives/label";

interface GuestMessageToggleProps {
  name?: string;
  defaultChecked?: boolean;
  preview?: string;
}

// The checkbox stays uncontrolled on purpose: MutationForm submits through an action prop and React
// resets the form afterwards, which would leave a controlled checkbox showing a different value
// than the one that gets posted.
export function GuestMessageToggle({
  name = "sendMessage",
  defaultChecked = true,
  preview,
}: GuestMessageToggleProps) {
  return (
    <div className="grid gap-3">
      <Label className="min-h-11 cursor-pointer">
        <input
          name={name}
          type="checkbox"
          className="size-4 accent-current"
          defaultChecked={defaultChecked}
        />
        Enviar mensaje por Instagram
      </Label>
      {preview ? (
        <details className="group">
          <summary className="admin-muted flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fffbf4] [&::-webkit-details-marker]:hidden [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary">
            Ver mensaje
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="mt-3 border-l border-border pl-3 text-sm break-words whitespace-pre-line">
            {preview}
          </p>
        </details>
      ) : null}
    </div>
  );
}
