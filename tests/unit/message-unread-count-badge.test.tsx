// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UnreadCountBadge } from "@/ui/admin/messages/unread-count-badge";

afterEach(cleanup);

describe("UnreadCountBadge", () => {
  it("renders nothing when there are no unread messages", () => {
    const { container } = render(<UnreadCountBadge count={0} />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the count with a spoken singular label", () => {
    render(<UnreadCountBadge count={1} />);

    expect(screen.getByText("1").getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("1 mensaje sin leer")).toBeDefined();
  });

  it("shows the exact count up to nine", () => {
    render(<UnreadCountBadge count={9} />);

    expect(screen.getByText("9")).toBeDefined();
    expect(screen.getByText("9 mensajes sin leer")).toBeDefined();
  });

  it("caps the visible count above nine but speaks the real number", () => {
    render(<UnreadCountBadge count={10} />);

    expect(screen.getByText("9+")).toBeDefined();
    expect(screen.getByText("10 mensajes sin leer")).toBeDefined();
  });
});
