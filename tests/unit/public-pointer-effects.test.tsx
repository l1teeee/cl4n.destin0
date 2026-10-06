// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicLanding } from "@/ui/public/public-landing";

let queuedFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

function stubPointerPreferences(finePointer: boolean, reducedMotion: boolean) {
  queuedFrames = new Map();
  nextFrameId = 1;

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)" ? finePointer : reducedMotion,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const frameId = nextFrameId++;
    queuedFrames.set(frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
    queuedFrames.delete(frameId);
  });
}

function flushAnimationFrames() {
  const frames = [...queuedFrames.values()];
  queuedFrames.clear();

  for (const frame of frames) {
    frame(0);
  }
}

function firePointerMove(x: number, y: number) {
  const PointerMoveEvent = window.PointerEvent ?? window.MouseEvent;
  fireEvent(window, new PointerMoveEvent("pointermove", { clientX: x, clientY: y }));
}

function firePointerLeave() {
  const PointerOutEvent = window.PointerEvent ?? window.MouseEvent;
  fireEvent(document, new PointerOutEvent("pointerout", { relatedTarget: null }));
}

function renderLanding() {
  return render(<PublicLanding status="Acceso cerrado">Pronto</PublicLanding>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public pointer effects", () => {
  it("moves the pupil and pointer light for a fine pointer", () => {
    stubPointerPreferences(true, false);
    const { container } = renderLanding();
    const mark = container.querySelector<SVGSVGElement>("svg.public-home-mark");
    const light = container.querySelector<HTMLElement>(".public-pointer-light");

    firePointerMove(640, 0);
    flushAnimationFrames();

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("1.000");
    expect(mark?.style.getPropertyValue("--pupil-y")).toBe("0.000");
    expect(light?.style.getPropertyValue("--light-x")).toBe("640px");
    expect(light?.style.getPropertyValue("--light-y")).toBe("0px");
    expect(light?.dataset.visible).toBe("true");

    firePointerLeave();

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("0");
    expect(mark?.style.getPropertyValue("--pupil-y")).toBe("0");
    expect(light?.hasAttribute("data-visible")).toBe(false);
  });

  it("does not attach effects when reduced motion is enabled", () => {
    stubPointerPreferences(true, true);
    const { container } = renderLanding();
    const mark = container.querySelector<SVGSVGElement>("svg.public-home-mark");
    const light = container.querySelector<HTMLElement>(".public-pointer-light");

    firePointerMove(640, 0);
    flushAnimationFrames();

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("");
    expect(light?.hasAttribute("data-visible")).toBe(false);
  });

  it("does not attach effects for a coarse pointer", () => {
    stubPointerPreferences(false, false);
    const { container } = renderLanding();
    const mark = container.querySelector<SVGSVGElement>("svg.public-home-mark");
    const light = container.querySelector<HTMLElement>(".public-pointer-light");

    firePointerMove(640, 0);
    flushAnimationFrames();

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("");
    expect(light?.hasAttribute("data-visible")).toBe(false);
  });

  it("applies only the latest pointer position once per animation frame", () => {
    stubPointerPreferences(true, false);
    const { container } = renderLanding();
    const mark = container.querySelector<SVGSVGElement>("svg.public-home-mark");
    const light = container.querySelector<HTMLElement>(".public-pointer-light");

    firePointerMove(100, 0);
    firePointerMove(640, 0);

    // Two consumers (light and watching mark) each throttle their own listener: 2 frames, not 4.
    expect(queuedFrames.size).toBe(2);

    flushAnimationFrames();

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("1.000");
    expect(light?.style.getPropertyValue("--light-x")).toBe("640px");
  });

  it("drops a pending frame when the pointer leaves the window before it runs", () => {
    stubPointerPreferences(true, false);
    const { container } = renderLanding();
    const mark = container.querySelector<SVGSVGElement>("svg.public-home-mark");
    const light = container.querySelector<HTMLElement>(".public-pointer-light");

    firePointerMove(640, 0);
    firePointerLeave();
    flushAnimationFrames();

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("0");
    expect(light?.hasAttribute("data-visible")).toBe(false);
  });
});
