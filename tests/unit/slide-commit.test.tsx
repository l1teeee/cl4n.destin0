// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SlideCommit from "@/ui/primitives/slide-commit";

describe("SlideCommit", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cancels an active grip with Escape or pointercancel", async () => {
    const handlers: Partial<Record<"pointermove" | "pointercancel", EventListener>> = {};
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      if ((type === "pointermove" || type === "pointercancel") && typeof listener === "function") {
        handlers[type] = listener;
      }
      addEventListener(type, listener, options);
    });
    const onConfirm = vi.fn();

    render(<SlideCommit label="Confirm" onConfirm={onConfirm} />);
    const slider = screen.getByRole("slider", { name: "Confirm" });

    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 10 });
    act(() => {
      handlers.pointermove?.({
        isTrusted: true,
        pointerId: 1,
        clientX: 10,
        timeStamp: 1,
      } as PointerEvent);
      handlers.pointermove?.({
        isTrusted: true,
        pointerId: 1,
        clientX: 300,
        timeStamp: 2,
      } as PointerEvent);
    });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("100"));
    fireEvent.keyDown(slider, { key: "Escape" });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("0"));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { button: 0, pointerId: 2, clientX: 10 });
    act(() => {
      handlers.pointermove?.({
        isTrusted: true,
        pointerId: 2,
        clientX: 10,
        timeStamp: 3,
      } as PointerEvent);
      handlers.pointermove?.({
        isTrusted: true,
        pointerId: 2,
        clientX: 300,
        timeStamp: 4,
      } as PointerEvent);
    });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("100"));
    act(() => {
      handlers.pointercancel?.({ isTrusted: true, pointerId: 2 } as PointerEvent);
    });
    await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("0"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
