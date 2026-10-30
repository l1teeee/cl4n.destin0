// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuestViewTabs } from "@/ui/admin/guests/guest-view-tabs";

vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

afterEach(cleanup);

const views = [
  { id: "revisar", label: "Por revisar", count: 3, href: "/admin/events/e1?vista=revisar" },
  { id: "lista", label: "En la lista", count: 12, href: "/admin/events/e1?vista=lista" },
  { id: "cola", label: "Cola", count: 0, href: "/admin/events/e1?vista=cola" },
];

describe("GuestViewTabs", () => {
  it("renders a labelled navigation with one link per view", () => {
    render(<GuestViewTabs views={views} activeId="revisar" />);

    const navigation = screen.getByRole("navigation", { name: "Vistas del listado" });
    expect(navigation.querySelectorAll("a")).toHaveLength(3);
  });

  it("shows each label with its count in parentheses and links to its href", () => {
    render(<GuestViewTabs views={views} activeId="revisar" />);

    expect(screen.getByRole("link", { name: "Por revisar (3)" }).getAttribute("href")).toBe(
      "/admin/events/e1?vista=revisar",
    );
    expect(screen.getByRole("link", { name: "En la lista (12)" }).getAttribute("href")).toBe(
      "/admin/events/e1?vista=lista",
    );
    expect(screen.getByRole("link", { name: "Cola (0)" }).getAttribute("href")).toBe(
      "/admin/events/e1?vista=cola",
    );
  });

  it("styles only the active view as the default button and marks it as the current page", () => {
    render(<GuestViewTabs views={views} activeId="lista" />);

    const active = screen.getByRole("link", { name: "En la lista (12)" });
    expect(active.getAttribute("data-variant")).toBe("default");
    expect(active.getAttribute("aria-current")).toBe("page");

    for (const name of ["Por revisar (3)", "Cola (0)"]) {
      const inactive = screen.getByRole("link", { name });
      expect(inactive.getAttribute("data-variant")).toBe("outline");
      expect(inactive.hasAttribute("aria-current")).toBe(false);
    }
  });

  it("moves the active styling when another view is active", () => {
    const { rerender } = render(<GuestViewTabs views={views} activeId="revisar" />);
    expect(screen.getByRole("link", { name: "Por revisar (3)" }).getAttribute("data-variant")).toBe(
      "default",
    );

    rerender(<GuestViewTabs views={views} activeId="cola" />);

    expect(screen.getByRole("link", { name: "Por revisar (3)" }).getAttribute("data-variant")).toBe(
      "outline",
    );
    expect(screen.getByRole("link", { name: "Cola (0)" }).getAttribute("data-variant")).toBe(
      "default",
    );
  });

  it("wraps the buttons on narrow screens", () => {
    render(<GuestViewTabs views={views} activeId="revisar" />);

    expect(screen.getByRole("navigation").className).toContain("flex-wrap");
  });
});
