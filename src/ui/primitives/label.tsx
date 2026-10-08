"use client";

import * as React from "react";
import { cn } from "@/ui/cn";
import { Label as LabelPrimitive } from "radix-ui";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-[0.72rem] leading-none font-normal tracking-[0.2em] text-[var(--clan-muted)] uppercase opacity-70 transition-opacity duration-200 select-none group-data-[disabled=true]:pointer-events-none peer-disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
