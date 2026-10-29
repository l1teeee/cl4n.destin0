// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkPendingIcon, LinkPendingIndicator } from "@/ui/admin/link-pending";

const linkStatus = vi.hoisted(() => ({ pending: false }));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: linkStatus.pending }),
}));

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

describe("LinkPendingIndicator", () => {
  it("renders nothing while the link is idle", () => {
    const { container } = render(<LinkPendingIndicator />);

    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a hidden spinner only while the link is pending", () => {
    linkStatus.pending = true;
    const view = render(<LinkPendingIndicator />);
    const spinner = view.container.querySelector("svg");

    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    expect(spinner?.getAttribute("class")).toContain("animate-spin");

    linkStatus.pending = false;
    view.rerender(<LinkPendingIndicator />);

    expect(view.container.querySelector("svg")).toBeNull();
  });
});

describe("LinkPendingIcon", () => {
  it("shows its child while the link is idle", () => {
    const { container } = render(
      <LinkPendingIcon>
        <svg data-testid="icon" />
      </LinkPendingIcon>,
    );

    expect(screen.getByTestId("icon")).toBeDefined();
    expect(container.querySelector("svg.animate-spin")).toBeNull();
  });

  it("swaps its child for a hidden spinner while the link is pending", () => {
    linkStatus.pending = true;
    const { container } = render(
      <LinkPendingIcon>
        <svg data-testid="icon" />
      </LinkPendingIcon>,
    );
    const spinner = container.querySelector("svg.animate-spin");

    expect(screen.queryByTestId("icon")).toBeNull();
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
  });
});
