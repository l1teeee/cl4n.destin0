// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationHeader } from "@/ui/admin/messages/conversation-header";
import type { ConversationHeaderView } from "@/ui/admin/messages/message-copy";

afterEach(cleanup);

const CLOSED_WINDOW_COPY =
  "La ventana de 24 horas está cerrada: lo que envíes saldrá cuando la persona vuelva a escribir. También puedes copiarlo y enviarlo desde Instagram.";

function header(overrides: Partial<ConversationHeaderView> = {}): ConversationHeaderView {
  return {
    contactId: "contact-1",
    title: "Ana Pérez",
    username: "ana.perez",
    windowOpen: true,
    windowClosesAt: new Date("2026-11-03T20:30:00.000Z"),
    linked: [],
    ...overrides,
  };
}

describe("ConversationHeader identity", () => {
  it("shows the title and links the username to the Instagram profile", () => {
    render(<ConversationHeader header={header()} controls={null} />);

    expect(screen.getByRole("heading", { name: "Ana Pérez" })).toBeDefined();
    const profile = screen.getByRole("link", { name: "@ana.perez" });
    expect(profile.getAttribute("href")).toBe("https://www.instagram.com/ana.perez/");
    expect(profile.getAttribute("target")).toBe("_blank");
    expect(profile.getAttribute("rel")).toContain("noopener");
  });

  it("omits the profile link when the contact has no username", () => {
    render(
      <ConversationHeader
        header={header({ title: "Contacto sin usuario", username: null })}
        controls={null}
      />,
    );

    expect(screen.getByRole("heading", { name: "Contacto sin usuario" })).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("ConversationHeader reply window", () => {
  it("tells when the window closes while it is open", () => {
    render(<ConversationHeader header={header()} controls={null} />);

    expect(screen.getByText("Puedes escribirle hasta las 14:30 del 3 de noviembre")).toBeDefined();
  });

  it("explains the closed window", () => {
    render(
      <ConversationHeader
        header={header({ windowOpen: false, windowClosesAt: null })}
        controls={null}
      />,
    );

    expect(screen.getByText(CLOSED_WINDOW_COPY)).toBeDefined();
  });
});

describe("ConversationHeader linked requests", () => {
  it("lists each linked request with its status and a link", () => {
    render(
      <ConversationHeader
        header={header({
          linked: [
            {
              id: "reservation-1",
              kind: "RESERVATION",
              label: "Reservación #012",
              statusLabel: "Confirmada",
              href: "/admin/events/event-1?seccion=reservaciones",
              mismatch: false,
            },
            {
              id: "entry-1",
              kind: "WAITLIST_ENTRY",
              label: "Cola #3",
              statusLabel: "En cola",
              href: "/admin/events/event-1?seccion=reservaciones&vista=en-cola",
              mismatch: false,
            },
          ],
        })}
        controls={null}
      />,
    );

    const requests = within(screen.getByRole("list", { name: "Solicitudes vinculadas" }));
    expect(requests.getByRole("link", { name: "Reservación #012" }).getAttribute("href")).toBe(
      "/admin/events/event-1?seccion=reservaciones",
    );
    expect(requests.getByText("Confirmada")).toBeDefined();
    expect(requests.getByRole("link", { name: "Cola #3" }).getAttribute("href")).toBe(
      "/admin/events/event-1?seccion=reservaciones&vista=en-cola",
    );
    expect(requests.getByText("En cola")).toBeDefined();
    expect(requests.queryByText("El usuario no coincide con la solicitud")).toBeNull();
    expect(screen.queryByText("Sin vincular a una solicitud")).toBeNull();
  });

  it("warns only on the request whose username does not match", () => {
    render(
      <ConversationHeader
        header={header({
          linked: [
            {
              id: "reservation-1",
              kind: "RESERVATION",
              label: "Reservación #012",
              statusLabel: "Confirmada",
              href: "/r/1",
              mismatch: false,
            },
            {
              id: "reservation-2",
              kind: "RESERVATION",
              label: "Reservación #013",
              statusLabel: "Confirmada",
              href: "/r/2",
              mismatch: true,
            },
          ],
        })}
        controls={null}
      />,
    );

    const [first, second] = screen.getAllByRole("listitem");
    expect(within(first!).queryByText("El usuario no coincide con la solicitud")).toBeNull();
    expect(within(second!).getByText("El usuario no coincide con la solicitud")).toBeDefined();
  });

  it("says so when nothing is linked", () => {
    render(<ConversationHeader header={header({ linked: [] })} controls={null} />);

    expect(screen.getByText("Sin vincular a una solicitud")).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("ConversationHeader controls slot", () => {
  it("renders whatever the page passes as controls", () => {
    render(
      <ConversationHeader
        header={header()}
        controls={<button type="button">Vincular solicitud</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Vincular solicitud" })).toBeDefined();
  });
});

describe("ConversationHeader link by code", () => {
  const linkByCodeAction = vi.fn(async () => ({ ok: true, message: "Vinculada." }));
  const linkedRequest = {
    id: "reservation-1",
    kind: "RESERVATION" as const,
    label: "Reservación #012",
    statusLabel: "Confirmada",
    href: "/r/1",
    mismatch: false,
  };
  const panel = () => document.getElementById("link-by-code-panel")!;

  it("keeps the code form collapsed until the button is pressed", () => {
    render(<ConversationHeader header={header()} linkByCodeAction={linkByCodeAction} />);
    const button = screen.getByRole("button", { name: "Vincular por código" });

    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(panel().hasAttribute("inert")).toBe(true);

    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Código de solicitud" }),
    );
  });

  it("collapses with Escape and with Cancelar, returning focus to the button", () => {
    render(<ConversationHeader header={header()} linkByCodeAction={linkByCodeAction} />);
    const button = screen.getByRole("button", { name: "Vincular por código" });

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("collapses after a successful link", async () => {
    render(<ConversationHeader header={header()} linkByCodeAction={linkByCodeAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Vincular por código" }));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "AB23CD" } });
    fireEvent.submit(screen.getByRole("button", { name: "Vincular" }).closest("form")!);

    await waitFor(() => expect(panel().hasAttribute("inert")).toBe(true));
  });

  it("offers no link button to read-only admins", () => {
    render(<ConversationHeader header={header()} />);

    expect(screen.queryByRole("button", { name: "Vincular por código" })).toBeNull();
    expect(document.getElementById("link-by-code-panel")).toBeNull();
  });

  it("offers no link button once the conversation is linked", () => {
    render(
      <ConversationHeader
        header={header({ linked: [linkedRequest] })}
        linkByCodeAction={linkByCodeAction}
      />,
    );

    expect(screen.queryByRole("button", { name: "Vincular por código" })).toBeNull();
    expect(screen.getByRole("link", { name: "Reservación #012" })).toBeDefined();
  });

  it("puts the window and link status in the right column next to the name", () => {
    render(<ConversationHeader header={header()} linkByCodeAction={linkByCodeAction} />);

    const rightColumn = screen.getByText("Sin vincular a una solicitud").parentElement!;
    expect(rightColumn.className).toContain("md:justify-items-end");
    expect(within(rightColumn).getByText(/Puedes escribirle hasta las/)).toBeDefined();
    expect(within(rightColumn).getByRole("button", { name: "Vincular por código" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Ana Pérez" }).parentElement).not.toBe(rightColumn);
  });
});
