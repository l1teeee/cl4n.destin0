import { useEffect, useEffectEvent } from "react";

export function useFinePointer(onMove: (x: number, y: number) => void, onLeave: () => void) {
  const handleMove = useEffectEvent(onMove);
  const handleLeave = useEffectEvent(onLeave);

  useEffect(() => {
    const hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!hasFinePointer || prefersReducedMotion) {
      return;
    }

    let latestX = 0;
    let latestY = 0;
    let frameId: number | null = null;

    const onPointerMove = (event: PointerEvent) => {
      latestX = event.clientX;
      latestY = event.clientY;

      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        handleMove(latestX, latestY);
      });
    };

    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        // A frame still pending here would re-show the effect after the pointer left.
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          frameId = null;
        }

        handleLeave();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);
}
