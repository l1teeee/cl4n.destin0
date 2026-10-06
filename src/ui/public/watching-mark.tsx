"use client";

import { useRef } from "react";

import { BrandMark } from "./brand-mark";
import { useFinePointer } from "./use-fine-pointer";

const FULL_GAZE_DISTANCE_PX = 320;

export function WatchingMark({ className }: { className?: string }) {
  const markRef = useRef<SVGSVGElement>(null);

  const resetPupil = () => {
    markRef.current?.style.setProperty("--pupil-x", "0");
    markRef.current?.style.setProperty("--pupil-y", "0");
  };

  useFinePointer((pointerX, pointerY) => {
    const mark = markRef.current;

    if (!mark) {
      return;
    }

    const rect = mark.getBoundingClientRect();
    const deltaX = pointerX - (rect.left + rect.width / 2);
    const deltaY = pointerY - (rect.top + rect.height / 2);
    const distance = Math.hypot(deltaX, deltaY);
    const gazeStrength = Math.min(distance / FULL_GAZE_DISTANCE_PX, 1);
    const pupilX = distance === 0 ? 0 : (deltaX / distance) * gazeStrength;
    const pupilY = distance === 0 ? 0 : (deltaY / distance) * gazeStrength;

    mark.style.setProperty("--pupil-x", pupilX.toFixed(3));
    mark.style.setProperty("--pupil-y", pupilY.toFixed(3));
  }, resetPupil);

  return <BrandMark className={className} ref={markRef} />;
}
