"use client";

import * as React from "react";
import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";

interface FieldHintProps {
  label: string;
  children: React.ReactNode;
}

function FieldHint({ label, children }: FieldHintProps) {
  const [open, setOpen] = React.useState(false);
  const openedByHover = React.useRef(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  function openForMouse(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    if (!open) openedByHover.current = true;
    setOpen(true);
  }

  function closeForMouse(event: React.PointerEvent) {
    if (event.pointerType !== "mouse" || !openedByHover.current) return;
    cancelClose();
    closeTimer.current = setTimeout(() => changeOpen(false), 150);
  }

  function pinWhenOpenedByHover(event: React.MouseEvent) {
    if (!openedByHover.current) return;
    event.preventDefault();
    openedByHover.current = false;
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) openedByHover.current = false;
    setOpen(nextOpen);
  }

  React.useEffect(() => () => cancelClose(), []);

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-6 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={pinWhenOpenedByHover}
          onPointerEnter={openForMouse}
          onPointerLeave={closeForMouse}
        >
          <Info aria-hidden="true" className="size-3.5 stroke-[1.5]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-w-64 text-xs leading-relaxed text-muted-foreground normal-case"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerEnter={openForMouse}
        onPointerLeave={closeForMouse}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export { FieldHint };
