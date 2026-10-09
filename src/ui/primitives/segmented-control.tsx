"use client";

import * as React from "react";
import { RadioGroup } from "radix-ui";

import { cn } from "@/ui/cn";

function SegmentedControl({ className, ...props }: React.ComponentProps<typeof RadioGroup.Root>) {
  return (
    <RadioGroup.Root
      className={cn("flex w-fit gap-1 rounded-full border border-border p-1", className)}
      {...props}
    />
  );
}

function SegmentedControlItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroup.Item>) {
  return (
    <RadioGroup.Item
      className={cn(
        "rounded-full px-4 py-2 text-sm font-bold tracking-wide text-muted-foreground transition-colors data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };
