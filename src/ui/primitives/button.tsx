import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { Slot } from "radix-ui";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent font-bold tracking-[0.08em] whitespace-nowrap transition-[color,background-color,border-color,opacity] duration-[250ms] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-transparent [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary focus-visible:bg-transparent focus-visible:text-primary",
        destructive:
          "border-destructive bg-transparent text-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-60 focus-visible:opacity-60",
        outline:
          "border-primary bg-transparent text-primary [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-60 focus-visible:opacity-60",
        ghost:
          "border-0 bg-transparent text-[#8d8b85] [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary focus-visible:bg-accent focus-visible:text-primary",
        link: "h-auto border-0 bg-transparent p-0 text-inherit [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-60 focus-visible:opacity-60",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-sm",
        icon: "size-11 p-0",
        "icon-sm": "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
