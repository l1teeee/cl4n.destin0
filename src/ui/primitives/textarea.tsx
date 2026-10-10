import * as React from "react";
import { cn } from "@/ui/cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "block field-sizing-content min-h-11 w-full rounded-none border border-input bg-transparent px-[0.8rem] py-[0.65rem] text-sm text-foreground transition-[border-color,background-color] duration-200 placeholder:text-muted-foreground disabled:opacity-50 read-only:opacity-50 focus:border-[#b9b7b0] focus:bg-[#fffbf405] focus-visible:outline-none aria-invalid:border-destructive aria-invalid:focus:border-destructive [@media(hover:hover)_and_(pointer:fine)]:aria-invalid:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
