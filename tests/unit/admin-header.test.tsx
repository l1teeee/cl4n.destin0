// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminHeader } from "@/ui/admin/admin-header";

const navigation = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

let showModal: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  navigation.pathname = "/admin";
  showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: showModal,
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: close,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function renderHeader(showUsersLink = true) {
  return render(
    <AdminHeader
      displayName="Administradora con nombre largo"
      showUsersLink={showUsersLink}
      signOutAction={vi.fn(async () => {})}
    />,
  );
}

describe("AdminHeader", () => {
  it("renders the vector mark without an image", () => {
    const { container } = renderHeader();
    const header = container.querySelector("header.admin-header");

    expect(header).not.toBeNull();
    const homeLink = within(header as HTMLElement).getByRole("link", {
      name: "Clandestino Admin, inicio",
    });
    const mark = homeLink.querySelector("svg.admin-brand-mark");
    expect(homeLink.getAttribute("href")).toBe("/admin");
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(header?.querySelector("img")).toBeNull();
  });

  it("marks the active link in both navigations", () => {
    navigation.pathname = "/admin/events/abc";
    const view = renderHeader();
    const adminNav = view.container.querySelector(".admin-nav") as HTMLElement;
    const menuNav = view.container.querySelector(".admin-menu-nav") as HTMLElement;

    for (const navigationElement of [adminNav, menuNav]) {
      expect(
        within(navigationElement)
          .getByRole("link", { name: "Experiencias", hidden: true })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(
        within(navigationElement)
          .getByRole("link", { name: "Auditoría", hidden: true })
          .hasAttribute("aria-current"),
      ).toBe(false);
    }

    navigation.pathname = "/admin/audit";
    view.rerender(
      <AdminHeader
        displayName="Administradora con nombre largo"
        showUsersLink
        signOutAction={vi.fn(async () => {})}
      />,
    );

    for (const navigationElement of [adminNav, menuNav]) {
      expect(
        within(navigationElement)
          .getByRole("link", { name: "Experiencias", hidden: true })
          .hasAttribute("aria-current"),
      ).toBe(false);
      expect(
        within(navigationElement)
          .getByRole("link", { name: "Auditoría", hidden: true })
          .getAttribute("aria-current"),
      ).toBe("page");
    }
  });

  it("shows the users link only when allowed", () => {
    const view = renderHeader(false);
    const adminNav = view.container.querySelector(".admin-nav") as HTMLElement;
    const menuNav = view.container.querySelector(".admin-menu-nav") as HTMLElement;

    expect(within(adminNav).queryByRole("link", { name: "Usuarios", hidden: true })).toBeNull();
    expect(within(menuNav).queryByRole("link", { name: "Usuarios", hidden: true })).toBeNull();

    for (const navigationElement of [adminNav, menuNav]) {
      expect(
        within(navigationElement)
          .getByRole("link", { name: "Mi cuenta", hidden: true })
          .getAttribute("href"),
      ).toBe("/admin/account");
    }

    view.rerender(
      <AdminHeader
        displayName="Administradora con nombre largo"
        showUsersLink
        signOutAction={vi.fn(async () => {})}
      />,
    );

    expect(within(adminNav).getAllByRole("link", { name: "Usuarios", hidden: true })).toHaveLength(
      1,
    );
    expect(within(menuNav).getAllByRole("link", { name: "Usuarios", hidden: true })).toHaveLength(
      1,
    );
  });

  it("opens and closes the menu", () => {
    const { container } = renderHeader();
    const header = container.querySelector("header.admin-header") as HTMLElement;
    const menu = container.querySelector("dialog.admin-menu") as HTMLElement;

    fireEvent.click(within(header).getByRole("button", { name: "Menú" }));
    expect(showModal).toHaveBeenCalledTimes(1);

    fireEvent.click(within(menu).getByRole("link", { name: "Correos" }));
    expect(close).toHaveBeenCalledTimes(1);

    fireEvent.click(within(menu).getByRole("button", { name: "Cerrar menú", hidden: true }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("renders the account details in the bar and menu", () => {
    const { container } = renderHeader();
    const account = container.querySelector(".admin-header-account") as HTMLElement;
    const menuAccount = container.querySelector(".admin-menu-account") as HTMLElement;

    for (const accountElement of [account, menuAccount]) {
      expect(within(accountElement).getByText("Administradora con nombre largo")).toBeDefined();
      expect(
        within(accountElement)
          .getByRole("button", {
            name: "Cerrar sesión",
            hidden: true,
          })
          .getAttribute("type"),
      ).toBe("submit");
    }
  });
});
