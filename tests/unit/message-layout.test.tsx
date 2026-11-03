// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessagesLayout } from "@/ui/admin/messages/messages-layout";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

function listPane(): HTMLElement {
  return screen.getByRole("region", { name: "Conversaciones" });
}

function conversationPane(): HTMLElement {
  return screen.getByRole("region", { name: "Conversación" });
}

describe("MessagesLayout without a selected conversation", () => {
  it("shows the list on mobile and a hint on desktop", () => {
    render(
      <MessagesLayout
        list={<p>Lista de conversaciones</p>}
        conversation={null}
        backHref="/admin/messages"
      />,
    );

    expect(listPane().textContent).toBe("Lista de conversaciones");
    expect(listPane().className).not.toMatch(/(^| )hidden( |$)/);
    expect(conversationPane().className).toContain("hidden");
    expect(conversationPane().className).toContain("md:flex");
    expect(conversationPane().textContent).toBe("Selecciona una conversación.");
  });

  it("has no back link because there is nothing to go back from", () => {
    render(<MessagesLayout list={<p>Lista</p>} conversation={null} backHref="/admin/messages" />);

    expect(screen.queryByRole("link", { name: "Volver" })).toBeNull();
  });
});

describe("MessagesLayout with a selected conversation", () => {
  function renderSelected() {
    return render(
      <MessagesLayout
        list={<p>Lista de conversaciones</p>}
        conversation={
          <>
            <h2>Ana Pérez</h2>
            <p>Hilo de mensajes</p>
          </>
        }
        backHref="/admin/messages?q=ana"
      />,
    );
  }

  it("shows only the conversation on mobile and both panes on desktop", () => {
    renderSelected();

    expect(listPane().className).toMatch(/(^| )hidden( |$)/);
    expect(listPane().className).toContain("md:block");
    expect(conversationPane().className).toMatch(/(^| )flex( |$)/);
    expect(conversationPane().className).not.toMatch(/(^| )hidden( |$)/);
    expect(screen.getByText("Lista de conversaciones")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Ana Pérez" })).toBeDefined();
    expect(screen.getByText("Hilo de mensajes")).toBeDefined();
    expect(screen.queryByText("Selecciona una conversación.")).toBeNull();
  });

  it("gives the list a fixed 320 px column and lets both panes scroll on their own", () => {
    renderSelected();

    expect(listPane().className).toContain("md:w-80");
    expect(listPane().className).toContain("overflow-y-auto");
    expect(conversationPane().className).toContain("flex-1");
    expect(conversationPane().className).toContain("min-h-0");
  });

  it("offers a back link to the list that is hidden on desktop", () => {
    renderSelected();

    const back = screen.getByRole("link", { name: "Volver" });
    expect(back.getAttribute("href")).toBe("/admin/messages?q=ana");
    expect(back.parentElement?.className).toContain("md:hidden");
  });
});
