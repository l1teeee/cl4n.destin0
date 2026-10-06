// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicLanding } from "@/ui/public/public-landing";

function stubPointerPreferences(finePointer: boolean, reducedMotion: boolean) {
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
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
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

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("");
    expect(light?.hasAttribute("data-visible")).toBe(false);
  });

  it("does not attach effects for a coarse pointer", () => {
    stubPointerPreferences(false, false);
    const { container } = renderLanding();
    const mark = container.querySelector<SVGSVGElement>("svg.public-home-mark");
    const light = container.querySelector<HTMLElement>(".public-pointer-light");

    firePointerMove(640, 0);

    expect(mark?.style.getPropertyValue("--pupil-x")).toBe("");
    expect(light?.hasAttribute("data-visible")).toBe(false);
  });
});
