// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminMobileBar, AdminSidebar } from "@/ui/admin/admin-sidebar";
import { SidebarInset, SidebarProvider } from "@/ui/primitives/sidebar";

const navigation = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

function setViewport(isMobile: boolean) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: isMobile ? 500 : 1024,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("hover: hover") ? !isMobile : isMobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const defaultProps = {
  displayName: "Administradora con nombre largo",
  showUsersLink: true,
  signOutAction: vi.fn(async () => {}),
};

function renderSidebar(props: Partial<ComponentProps<typeof AdminSidebar>> = {}) {
  return render(
    <SidebarProvider defaultOpen={false}>
      <AdminSidebar {...defaultProps} {...props} />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  navigation.pathname = "/admin";
  setViewport(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminSidebar", () => {
  it("uses a div for the sidebar inset so pages own the main landmark", () => {
    const { container } = render(<SidebarInset />);

    expect(container.firstElementChild?.tagName).toBe("DIV");
  });

  it("renders the circle mark link without an image", () => {
    const { container } = renderSidebar();
    const homeLink = screen.getByRole("link", { name: "Clandestino Admin, inicio" });

    expect(homeLink.getAttribute("href")).toBe("/admin");
    expect(homeLink.querySelector("svg.admin-brand-mark")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("marks the matching section as active", () => {
    navigation.pathname = "/admin/events/abc";
    const view = renderSidebar();

    expect(screen.getByRole("link", { name: "Experiencias" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Auditoría" }).hasAttribute("aria-current")).toBe(
      false,
    );

    navigation.pathname = "/admin/audit";
    view.rerender(
      <SidebarProvider defaultOpen={false}>
        <AdminSidebar {...defaultProps} />
      </SidebarProvider>,
    );

    expect(screen.getByRole("link", { name: "Experiencias" }).hasAttribute("aria-current")).toBe(
      false,
    );
    expect(screen.getByRole("link", { name: "Auditoría" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("shows the users link only when allowed", () => {
    const view = renderSidebar({ showUsersLink: false });

    expect(screen.queryByRole("link", { name: "Usuarios" })).toBeNull();

    view.rerender(
      <SidebarProvider defaultOpen={false}>
        <AdminSidebar {...defaultProps} showUsersLink />
      </SidebarProvider>,
    );

    expect(screen.getByRole("link", { name: "Usuarios" }).getAttribute("href")).toBe(
      "/admin/users",
    );
  });

  it("renders sign out as a submit button inside a form", () => {
    renderSidebar();
    const button = screen.getByRole("button", { name: "Cerrar sesión" });

    expect(button.getAttribute("type")).toBe("submit");
    expect(button.closest("form")).not.toBeNull();
  });

  it("switches the collapse toggle label", () => {
    renderSidebar();
    const toggle = screen.getByRole("button", { name: "Expandir menú" });

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Contraer menú" })).toBeDefined();
  });

  it("opens and closes the mobile sheet", () => {
    setViewport(true);
    render(
      <SidebarProvider defaultOpen={false}>
        <AdminSidebar {...defaultProps} />
        <AdminMobileBar />
      </SidebarProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("link", { name: "Correos" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("centers each collapsed icon in its button", () => {
    renderSidebar();

    for (const name of ["Experiencias", "Cerrar sesión", "Expandir menú"]) {
      const button = screen.getByRole(name === "Experiencias" ? "link" : "button", { name });
      expect(button.className).toContain("group-data-[collapsible=icon]:justify-center");
      expect(button.className).toContain("group-data-[collapsible=icon]:gap-0");
    }
  });
});

describe("AdminSidebar hover peek", () => {
  const sidebarRoot = () => document.querySelector("[data-slot=sidebar]")!;
  const sidebarContainer = () => document.querySelector("[data-slot=sidebar-container]")!;
  const sidebarGap = () => document.querySelector("[data-slot=sidebar-gap]")!;

  function mouseEvent(type: string) {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    return event;
  }

  function enter() {
    act(() => {
      sidebarContainer().dispatchEvent(mouseEvent("pointerover"));
    });
  }

  function leave() {
    act(() => {
      sidebarContainer().dispatchEvent(mouseEvent("pointerout"));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expands visually after the intent delay without shifting the content gap", () => {
    renderSidebar();

    enter();
    act(() => vi.advanceTimersByTime(119));
    expect(sidebarRoot().getAttribute("data-state")).toBe("collapsed");

    act(() => vi.advanceTimersByTime(1));
    expect(sidebarRoot().getAttribute("data-state")).toBe("expanded");
    expect(sidebarGap().className).toContain("w-(--sidebar-width-icon)");
    expect(sidebarGap().className).not.toContain("w-(--sidebar-width) ");
  });

  it("closes only after the close delay and cancels it on re-entry", () => {
    renderSidebar();
    enter();
    act(() => vi.advanceTimersByTime(120));

    leave();
    act(() => vi.advanceTimersByTime(1999));
    expect(sidebarRoot().getAttribute("data-state")).toBe("expanded");
    act(() => vi.advanceTimersByTime(1));
    expect(sidebarRoot().getAttribute("data-state")).toBe("collapsed");

    enter();
    act(() => vi.advanceTimersByTime(120));
    leave();
    act(() => vi.advanceTimersByTime(1500));
    enter();
    act(() => vi.advanceTimersByTime(5000));
    expect(sidebarRoot().getAttribute("data-state")).toBe("expanded");
  });

  it("never opens when the pointer leaves before the intent delay", () => {
    renderSidebar();

    enter();
    act(() => vi.advanceTimersByTime(60));
    leave();
    act(() => vi.advanceTimersByTime(5000));

    expect(sidebarRoot().getAttribute("data-state")).toBe("collapsed");
  });

  it("pins open when the toggle is clicked while peeking", () => {
    renderSidebar();
    enter();
    act(() => vi.advanceTimersByTime(120));

    fireEvent.click(screen.getByRole("button", { name: "Expandir menú" }));
    leave();
    act(() => vi.advanceTimersByTime(5000));

    expect(sidebarRoot().getAttribute("data-state")).toBe("expanded");
    expect(sidebarGap().className).not.toContain("w-(--sidebar-width-icon) ");
    expect(screen.getByRole("button", { name: "Contraer menú" })).toBeDefined();
  });

  it("ignores hover when the sidebar is pinned open", () => {
    render(
      <SidebarProvider defaultOpen>
        <AdminSidebar {...defaultProps} />
      </SidebarProvider>,
    );

    enter();
    act(() => vi.advanceTimersByTime(120));
    leave();
    act(() => vi.advanceTimersByTime(5000));

    expect(sidebarRoot().getAttribute("data-state")).toBe("expanded");
  });

  it("does not render a peek on mobile", () => {
    setViewport(true);
    renderSidebar();

    expect(document.querySelector("[data-slot=sidebar-container]")).toBeNull();
  });
});
