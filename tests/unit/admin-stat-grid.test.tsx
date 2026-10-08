// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { StatGrid } from "@/ui/admin/stat-grid";
import { formatCount } from "@/ui/admin/view-model";

const motionState = vi.hoisted(() => ({ reducedMotion: false }));

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    useReducedMotion: () => motionState.reducedMotion,
  };
});

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  motionState.reducedMotion = false;
});

describe("StatGrid", () => {
  it.each([
    { reducedMotion: false, displayValue: "0" },
    { reducedMotion: true, displayValue: formatCount(1234) },
  ])(
    "keeps the accessible number structure when reduced motion is $reducedMotion",
    ({ reducedMotion, displayValue }) => {
      motionState.reducedMotion = reducedMotion;
      render(<StatGrid items={[{ label: "Reservaciones", value: 1234 }]} />);

      const finalValue = screen.getByText(formatCount(1234), { selector: ".sr-only" });
      const display = finalValue.previousElementSibling;

      expect(display?.getAttribute("aria-hidden")).toBe("true");
      expect(display?.textContent).toBe(displayValue);
      expect(finalValue.className).toContain("sr-only");
    },
  );

  it("renders string values as text", () => {
    render(<StatGrid items={[{ label: "Estado", value: "Abierta" }]} />);

    expect(screen.getByText("Abierta")).toBeDefined();
  });
});
