import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { Slot } from "radix-ui";

const badgeVariants = cva(
  "inline-block w-fit shrink-0 rounded-none border [border-color:color-mix(in_srgb,currentColor_55%,transparent)] bg-transparent px-[0.4rem] py-1 text-[0.65rem] leading-[1.3] tracking-[0.18em] whitespace-nowrap uppercase [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "text-[var(--clan-muted)]",
        open: "text-primary",
        waitlist: "text-primary",
        draft: "text-[#8d8b85]",
        closed: "text-[#8d8b85]",
        inactive: "text-[#8d8b85]",
        cancelled: "text-destructive",
        rejected: "text-destructive",
        confirmed: "text-success",
        active: "text-success",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants, type BadgeVariant };
