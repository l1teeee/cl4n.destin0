// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination } from "@/ui/admin/pagination";

vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

afterEach(cleanup);

function renderPagination(page: number, total: number, pageSize = 10) {
  return render(
    <Pagination
      page={page}
      total={total}
      pageSize={pageSize}
      pageHref={(target) => `/admin/audit?page=${target}`}
    />,
  );
}

describe("Pagination", () => {
  it("shows a compact summary of the visible range", () => {
    renderPagination(2, 62);

    expect(screen.getByText("11-20 de 62")).toBeDefined();
  });

  it("labels every control and marks the current page", () => {
    renderPagination(2, 62);

    expect(screen.getByRole("link", { name: "Página 2" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "Página 3" }).hasAttribute("aria-current")).toBe(false);
    expect(screen.getByRole("link", { name: "Página anterior" }).getAttribute("href")).toBe(
      "/admin/audit?page=1",
    );
    expect(screen.getByRole("link", { name: "Página siguiente" }).getAttribute("href")).toBe(
      "/admin/audit?page=3",
    );
    expect(screen.getByRole("link", { name: "Primera página" }).getAttribute("href")).toBe(
      "/admin/audit?page=1",
    );
    expect(screen.getByRole("link", { name: "Última página" }).getAttribute("href")).toBe(
      "/admin/audit?page=7",
    );
  });

  it("shows at most five page numbers around the current page", () => {
    renderPagination(6, 200);

    const numbers = screen
      .getAllByRole("link", { name: /^Página \d+$/ })
      .map((link) => link.textContent);

    expect(numbers).toEqual(["4", "5", "6", "7", "8"]);
  });

  it("disables previous and first on the first page, next and last on the last", () => {
    const view = renderPagination(1, 62);

    expect(
      screen.getByRole("link", { name: "Página anterior" }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: "Primera página" }).hasAttribute("href")).toBe(false);

    view.unmount();
    renderPagination(7, 62);

    expect(
      screen.getByRole("link", { name: "Página siguiente" }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(screen.getByRole("link", { name: "Última página" }).hasAttribute("href")).toBe(false);
  });

  it("handles an empty result", () => {
    renderPagination(1, 0);

    expect(screen.getByText("0-0 de 0")).toBeDefined();
    expect(screen.getByRole("link", { name: "Página 1" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });
});
