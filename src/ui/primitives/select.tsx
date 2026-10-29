"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";

import { cn } from "@/ui/cn";

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("block min-w-0 flex-1 truncate text-left", className)}
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "group flex min-h-11 min-w-0 w-full items-center justify-between gap-3 rounded-md border border-input bg-[#fffbf405] px-4 py-2.5 text-sm text-foreground transition-[border-color,background-color,box-shadow] duration-200 disabled:opacity-50 focus:border-[#b9b7b0] focus:bg-[#fffbf40a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:border-[#b9b7b0] data-[state=open]:bg-[#fffbf40a] aria-invalid:border-destructive aria-invalid:focus:border-destructive data-[placeholder]:text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:aria-invalid:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 stroke-[1.5] text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        align="start"
        collisionPadding={12}
        className={cn(
          "z-50 w-[min(20rem,calc(100vw-2rem))] min-w-[var(--radix-select-trigger-width)] max-h-[min(22rem,var(--radix-select-content-available-height))] animate-in overflow-hidden rounded-xl border border-input/60 bg-popover text-popover-foreground shadow-[0_18px_48px_#0009] fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="w-full max-h-[min(21rem,var(--radix-select-content-available-height))] overflow-y-auto overscroll-contain p-1.5">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-11 w-full cursor-default items-center rounded-md py-2.5 pr-10 pl-4 text-sm leading-5 text-[#b9b7b0] outline-none select-none focus:bg-accent focus:text-foreground data-[state=checked]:bg-accent data-[state=checked]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-3.5 stroke-[1.5]" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
