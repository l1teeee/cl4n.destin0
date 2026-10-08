// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import CountUp from "@/ui/primitives/count-up";
import SlideCommit from "@/ui/primitives/slide-commit";

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

afterEach(cleanup);

describe("Button", () => {
  it.each(["default", "outline", "destructive", "ghost", "link"] as const)(
    "renders the %s variant as a pill button",
    (variant) => {
      render(<Button variant={variant}>Action</Button>);

      expect(screen.getByRole("button").className).toContain("rounded-full");
    },
  );

  it("renders its child with button classes", () => {
    render(
      <Button asChild>
        <a href="/admin">Admin</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Admin" });
    expect(link.tagName).toBe("A");
    expect(link.className).toContain("rounded-full");
  });
});

describe("Badge", () => {
  it.each([
    "default",
    "open",
    "waitlist",
    "draft",
    "closed",
    "inactive",
    "cancelled",
    "rejected",
    "confirmed",
    "active",
  ] as const)("renders the %s variant", (variant) => {
    render(<Badge variant={variant}>{variant}</Badge>);

    expect(screen.getByText(variant)).toBeDefined();
  });
});

describe("SlideCommit", () => {
  it("renders an accessible slider", () => {
    render(<SlideCommit label="Confirm reservation" />);

    expect(screen.getByRole("slider", { name: "Confirm reservation" })).toBeDefined();
  });

  it("removes disabled sliders from the tab order", () => {
    render(<SlideCommit label="Confirm reservation" disabled />);

    const slider = screen.getByRole("slider", { name: "Confirm reservation" });
    expect(slider.getAttribute("tabindex")).toBe("-1");
    expect(slider.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("CountUp", () => {
  it("renders without throwing", () => {
    expect(() => render(<CountUp to={12} />)).not.toThrow();
  });
});
