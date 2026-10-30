// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GuestDetailSheet } from "@/ui/admin/guests/guest-detail-sheet";

afterEach(cleanup);

type SheetProps = ComponentProps<typeof GuestDetailSheet>;

const baseProps: SheetProps = {
  triggerLabel: "Ver ficha",
  title: "Ana López y Luis Pérez",
  subtitle: "#004 · En la lista",
  guests: [
    { name: "Ana López", instagram: "ana.lopez", profileHref: "https://instagram.com/ana.lopez" },
    {
      name: "Luis Pérez",
      instagram: "luis.perez",
      profileHref: "https://instagram.com/luis.perez",
    },
  ],
  partyLabel: "2 personas",
  allergies: "Ana: maní",
  notes: "Llegan juntos\nMesa tranquila",
  timeline: [
    { label: "Solicitud recibida", at: "29/10/2026 20:15" },
    { label: "Aceptada", at: "30/10/2026 09:40" },
  ],
  messages: <p>Conversación de prueba</p>,
  actions: <button type="button">Cancelar invitado</button>,
};

function openSheet(overrides: Partial<SheetProps> = {}) {
  render(<GuestDetailSheet {...baseProps} {...overrides} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver ficha" }));
  return screen.getByRole("dialog");
}

function sectionTitles(dialog: HTMLElement) {
  return within(dialog)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent);
}

describe("GuestDetailSheet trigger", () => {
  it("shows only a small trigger button until it is clicked", () => {
    render(<GuestDetailSheet {...baseProps} />);

    const trigger = screen.getByRole("button", { name: "Ver ficha" });
    expect(trigger.getAttribute("data-size")).toBe("sm");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the sheet from the right with the title and subtitle", () => {
    const dialog = openSheet();

    expect(dialog.getAttribute("data-slot")).toBe("sheet-content");
    expect(dialog.className).toContain("slide-in-from-right");
    expect(within(dialog).getByRole("heading", { name: "Ana López y Luis Pérez" })).toBeDefined();
    expect(within(dialog).getByText("#004 · En la lista")).toBeDefined();
  });

  it("closes again with the Escape key", () => {
    const dialog = openSheet();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("GuestDetailSheet sections", () => {
  it("shows every section in order", () => {
    const dialog = openSheet();

    expect(sectionTitles(dialog)).toEqual([
      "Invitados",
      "Personas",
      "Alergias",
      "Observaciones",
      "Historial",
      "Mensajes",
      "Acciones",
    ]);
  });

  it("shows both guests with their Instagram profile links", () => {
    const dialog = openSheet();

    const links = within(dialog).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["@ana.lopez", "@luis.perez"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://instagram.com/ana.lopez",
      "https://instagram.com/luis.perez",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(within(dialog).getByText("Ana López")).toBeDefined();
    expect(within(dialog).getByText("Luis Pérez")).toBeDefined();
  });

  it("shows the party label", () => {
    const dialog = openSheet();

    expect(within(dialog).getByText("2 personas")).toBeDefined();
  });

  it("highlights the allergies as the table does", () => {
    const dialog = openSheet();

    expect(within(dialog).getByText("Alergias", { selector: "[data-slot=badge]" })).toBeDefined();
    const text = within(dialog).getByText("Ana: maní");
    expect(text.className).toContain("text-destructive");
    expect(text.className).toContain("font-semibold");
  });

  it("shows No when there are no allergies", () => {
    const dialog = openSheet({ allergies: null });

    expect(within(dialog).getByText("No")).toBeDefined();
    expect(within(dialog).queryByText("Alergias", { selector: "[data-slot=badge]" })).toBeNull();
  });

  it("keeps the line breaks of the notes", () => {
    const dialog = openSheet();

    const notes = within(dialog).getByText((_, element) =>
      Boolean(element?.tagName === "P" && element.textContent === "Llegan juntos\nMesa tranquila"),
    );
    expect(notes.className).toContain("whitespace-pre-line");
  });

  it("lists the timeline entries in order with their dates", () => {
    const dialog = openSheet();

    const items = within(dialog.querySelector("ol")!).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Solicitud recibida29/10/2026 20:15",
      "Aceptada30/10/2026 09:40",
    ]);
  });

  it("slots the messages and the actions in their own sections", () => {
    const dialog = openSheet();

    const messages = within(dialog).getByRole("heading", { name: "Mensajes" }).parentElement!;
    expect(within(messages).getByText("Conversación de prueba")).toBeDefined();
    const actions = within(dialog).getByRole("heading", { name: "Acciones" }).parentElement!;
    expect(within(actions).getByRole("button", { name: "Cancelar invitado" })).toBeDefined();
  });
});

describe("GuestDetailSheet optional sections", () => {
  it("omits the notes section when there are no notes", () => {
    const dialog = openSheet({ notes: null });

    expect(sectionTitles(dialog)).not.toContain("Observaciones");
  });

  it("omits the timeline section when there are no entries", () => {
    const dialog = openSheet({ timeline: [] });

    expect(sectionTitles(dialog)).not.toContain("Historial");
  });

  it("omits the messages and actions sections when nothing is slotted in", () => {
    const dialog = openSheet({ messages: null, actions: null });

    expect(sectionTitles(dialog)).toEqual([
      "Invitados",
      "Personas",
      "Alergias",
      "Observaciones",
      "Historial",
    ]);
  });
});
