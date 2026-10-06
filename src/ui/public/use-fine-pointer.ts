import { useEffect, useEffectEvent } from "react";

export function useFinePointer(onMove: (x: number, y: number) => void, onLeave: () => void) {
  const handleMove = useEffectEvent(onMove);
  const handleLeave = useEffectEvent(onLeave);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

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

      frameId = -1;
      const requestedFrameId = window.requestAnimationFrame(() => {
        frameId = null;
        handleMove(latestX, latestY);
      });

      if (frameId === -1) {
        frameId = requestedFrameId;
      }
    };

    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        handleLeave();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerout", onPointerOut);

      if (frameId !== null && frameId !== -1) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);
}
