// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationList } from "@/ui/admin/messages/conversation-list";
import type { ConversationListItemView } from "@/ui/admin/messages/message-copy";
import { TooltipProvider } from "@/ui/primitives/tooltip";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(cleanup);

function item(overrides: Partial<ConversationListItemView> = {}): ConversationListItemView {
  return {
    contactId: "contact-1",
    title: "Ana Pérez",
    username: "ana.perez",
    preview: "Hola, ¿a qué hora es?",
    lastActivityLabel: "10:42",
    unreadCount: 0,
    linkedLabel: "Reservación #012",
    mismatch: false,
    href: "/admin/messages?contacto=contact-1",
    ...overrides,
  };
}

function renderList(props: Partial<Parameters<typeof ConversationList>[0]> = {}) {
  return render(
    <TooltipProvider>
      <ConversationList
        items={[item()]}
        activeContactId={null}
        search=""
        unlinkedOnly={false}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("ConversationList search form", () => {
  it("is a plain GET form with the search box, the unlinked filter and a submit button", () => {
    renderList();

    const search = screen.getByRole("textbox", { name: "Buscar por usuario" });
    const form = search.closest("form");
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.hasAttribute("action")).toBe(false);
    expect(search.getAttribute("name")).toBe("q");

    const unlinked = screen.getByRole("checkbox", { name: "Solo sin vincular" });
    expect(unlinked.getAttribute("name")).toBe("sinVincular");
    expect(unlinked.getAttribute("value")).toBe("1");
    expect(within(form!).getByRole("button", { name: "Buscar" }).getAttribute("type")).toBe(
      "submit",
    );
  });

  it("fills the form with the current filters", () => {
    renderList({ search: "ana", unlinkedOnly: true });

    expect(
      (screen.getByRole("textbox", { name: "Buscar por usuario" }) as HTMLInputElement).value,
    ).toBe("ana");
    expect(
      (screen.getByRole("checkbox", { name: "Solo sin vincular" }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("leaves the filters empty by default", () => {
    renderList();

    expect(
      (screen.getByRole("textbox", { name: "Buscar por usuario" }) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByRole("checkbox", { name: "Solo sin vincular" }) as HTMLInputElement).checked,
    ).toBe(false);
  });
});

describe("ConversationList items", () => {
  it("links every conversation to its href with title, preview and time", () => {
    renderList({
      items: [
        item(),
        item({
          contactId: "contact-2",
          title: "@luis",
          preview: "Gracias",
          lastActivityLabel: "ayer",
          href: "/admin/messages?contacto=contact-2",
        }),
      ],
    });

    const links = within(screen.getByRole("list", { name: "Conversaciones" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/admin/messages?contacto=contact-1",
      "/admin/messages?contacto=contact-2",
    ]);
    expect(within(links[0]!).getByText("Ana Pérez")).toBeDefined();
    expect(within(links[0]!).getByText("Hola, ¿a qué hora es?")).toBeDefined();
    expect(within(links[0]!).getByText("10:42")).toBeDefined();
    expect(within(links[1]!).getByText("@luis")).toBeDefined();
    expect(within(links[1]!).getByText("ayer")).toBeDefined();
  });

  it("truncates the preview to one line", () => {
    renderList();

    expect(screen.getByText("Hola, ¿a qué hora es?").className).toContain("truncate");
  });

  it("highlights only the active conversation", () => {
    renderList({
      items: [item(), item({ contactId: "contact-2", title: "Luis", href: "/admin/messages?c=2" })],
      activeContactId: "contact-2",
    });

    const [first, second] = screen.getAllByRole("link");
    expect(first!.getAttribute("aria-current")).toBeNull();
    expect(second!.getAttribute("aria-current")).toBe("page");
    expect(second!.className).toContain("bg-accent");
    expect(first!.className).not.toContain("border-primary");
  });

  it("shows no active conversation when none is selected", () => {
    renderList({ items: [item(), item({ contactId: "contact-2", title: "Luis" })] });

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }
  });

  it("shows the linked request label or Sin vincular", () => {
    renderList({
      items: [
        item({ linkedLabel: "Reservación #012" }),
        item({ contactId: "contact-2", linkedLabel: null }),
      ],
    });

    const [linked, unlinked] = screen.getAllByRole("link");
    expect(within(linked!).getByText("Reservación #012")).toBeDefined();
    expect(within(linked!).queryByText("Sin vincular")).toBeNull();
    expect(within(unlinked!).getByText("Sin vincular")).toBeDefined();
  });

  it("shows the unread count only when there is something unread", () => {
    renderList({
      items: [
        item({ contactId: "read", unreadCount: 0 }),
        item({ contactId: "few", unreadCount: 3 }),
        item({ contactId: "many", unreadCount: 12 }),
      ],
    });

    const [read, few, many] = screen.getAllByRole("link");
    expect(within(read!).queryByText(/sin leer/)).toBeNull();
    expect(within(few!).getByText("3")).toBeDefined();
    expect(within(many!).getByText("9+")).toBeDefined();
  });

  it("marks a mismatched username with a warning and explains it in a tooltip", async () => {
    renderList({
      items: [
        item({ contactId: "ok", mismatch: false }),
        item({ contactId: "bad", mismatch: true }),
      ],
    });

    const [ok, bad] = screen.getAllByRole("link");
    expect(within(ok!).queryByRole("img")).toBeNull();
    const warning = within(bad!).getByRole("img", {
      name: "El usuario no coincide con la solicitud",
    });

    fireEvent.focus(warning);

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "El usuario no coincide con la solicitud",
    );
  });

  it("shows an empty state and keeps the search form", () => {
    renderList({ items: [] });

    expect(screen.getByText("No hay conversaciones todavía.")).toBeDefined();
    expect(screen.queryByRole("list", { name: "Conversaciones" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Buscar por usuario" })).toBeDefined();
  });
});
