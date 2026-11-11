import { Check } from "lucide-react";

import { cn } from "@/ui/cn";

const STEP_LABELS = ["Archivo", "Columnas", "Revisión", "Resultado"] as const;

type ImportStep = 1 | 2 | 3 | 4;

export function ImportSteps({ current }: { current: ImportStep }) {
  return (
    <ol className="flex items-center gap-3 sm:gap-6" aria-label="Pasos de la importación">
      {STEP_LABELS.map((label, index) => {
        const number = index + 1;
        const isCurrent = number === current;
        const isDone = number < current;
        return (
          <li
            key={label}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 text-sm transition-colors duration-200",
              isCurrent ? "text-[#fffbf4]" : "admin-muted",
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs transition-colors duration-200",
                isCurrent ? "border-primary bg-primary text-primary-foreground" : "border-border",
              )}
            >
              {isDone ? <Check className="size-4 text-success" aria-hidden="true" /> : number}
            </span>
            <span className={isCurrent ? "" : "sr-only sm:not-sr-only"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
