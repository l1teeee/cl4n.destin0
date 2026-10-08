import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/ui/cn";

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "block min-h-11 w-full appearance-none rounded-none border border-input bg-transparent px-[0.8rem] py-[0.65rem] pr-10 text-sm text-foreground transition-[border-color,background-color] duration-200 disabled:opacity-50 focus:border-primary focus:bg-[#fffbf405] aria-invalid:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
