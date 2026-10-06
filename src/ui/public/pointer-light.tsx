"use client";

import { useRef } from "react";

import { useFinePointer } from "./use-fine-pointer";

export function PointerLight() {
  const lightRef = useRef<HTMLDivElement>(null);

  useFinePointer(
    (x, y) => {
      const light = lightRef.current;

      if (!light) {
        return;
      }

      light.style.setProperty("--light-x", `${x}px`);
      light.style.setProperty("--light-y", `${y}px`);
      light.dataset.visible = "true";
    },
    () => {
      lightRef.current?.removeAttribute("data-visible");
    },
  );

  return <div ref={lightRef} className="public-pointer-light" aria-hidden="true" />;
}
