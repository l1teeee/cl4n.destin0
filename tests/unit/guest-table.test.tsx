// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GuestTable, type GuestRowView } from "@/ui/admin/guests/guest-table";

afterEach(cleanup);

function guestRow(overrides: Partial<GuestRowView> = {}): GuestRowView {
  return {
    key: "request-1",
    numberLabel: "#004",
    guests: [
      { name: "Ana López", instagram: "ana.lopez", profileHref: "https://instagram.com/ana.lopez" },
    ],
    partyLabel: "1 persona",
    allergies: null,
    notes: null,
    status: { label: "Por revisar", variant: "waitlist" },
    extra: null,
    message: null,
    submittedLabel: "30/10/2026 14:05",
    detail: null,
    actions: null,
    ...overrides,
  };
}

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell");
}

describe("GuestTable empty state", () => {
  it("shows the empty text and no table", () => {
    render(<GuestTable rows={[]} emptyText="No hay personas en esta vista." />);

    expect(screen.getByText("No hay personas en esta vista.")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("GuestTable columns", () => {
  it("renders the eight column headings in order", () => {
    render(<GuestTable rows={[guestRow()]} emptyText="" />);

    const headings = screen.getAllByRole("columnheader").map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Número",
      "Invitados",
      "Personas",
      "Alergias",
      "Estado",
      "Mensaje",
      "Recibida",
      "Acciones",
    ]);
  });

  it("keeps the horizontal scroll container of the table primitive", () => {
    const { container } = render(<GuestTable rows={[guestRow()]} emptyText="" />);

    const wrapper = container.querySelector('[data-slot="table-container"]');
    expect(wrapper?.className).toContain("overflow-x-auto");
  });

  it("renders the number, party, status and received date of a row", () => {
    render(<GuestTable rows={[guestRow()]} emptyText="" />);

    const cells = cellsOf(bodyRows()[0]!);
    expect(cells).toHaveLength(8);
    expect(cells[0]!.textContent).toBe("#004");
    expect(cells[0]!.className).toContain("font-mono");
    expect(cells[2]!.textContent).toBe("1 persona");
    expect(within(cells[4]!).getByText("Por revisar").getAttribute("data-variant")).toBe(
      "waitlist",
    );
    expect(cells[6]!.textContent).toBe("30/10/2026 14:05");
  });

  it("shows a queue number label as given", () => {
    render(<GuestTable rows={[guestRow({ numberLabel: "Cola #2" })]} emptyText="" />);

    expect(cellsOf(bodyRows()[0]!)[0]!.textContent).toBe("Cola #2");
  });
});

describe("GuestTable guests", () => {
  it("shows one guest with the name and a profile link below it", () => {
    render(<GuestTable rows={[guestRow()]} emptyText="" />);

    const guestsCell = cellsOf(bodyRows()[0]!)[1]!;
    expect(within(guestsCell).getByText("Ana López")).toBeDefined();
    const link = within(guestsCell).getByRole("link", { name: "@ana.lopez" });
    expect(link.getAttribute("href")).toBe("https://instagram.com/ana.lopez");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows two guests each with their own name line and profile link", () => {
    render(
      <GuestTable
        rows={[
          guestRow({
            guests: [
              {
                name: "Ana López",
                instagram: "ana.lopez",
                profileHref: "https://instagram.com/ana.lopez",
              },
              {
                name: "Luis Pérez",
                instagram: "luis.perez",
                profileHref: "https://instagram.com/luis.perez",
              },
            ],
            partyLabel: "2 personas",
          }),
        ]}
        emptyText=""
      />,
    );

    const guestsCell = cellsOf(bodyRows()[0]!)[1]!;
    const items = within(guestsCell).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Ana López")).toBeDefined();
    expect(within(items[1]!).getByText("Luis Pérez")).toBeDefined();
    const links = within(guestsCell).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://instagram.com/ana.lopez",
      "https://instagram.com/luis.perez",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(links.map((link) => link.textContent)).toEqual(["@ana.lopez", "@luis.perez"]);
  });

  it("shows the notes muted below the guests", () => {
    render(<GuestTable rows={[guestRow({ notes: "Llega tarde" })]} emptyText="" />);

    const guestsCell = cellsOf(bodyRows()[0]!)[1]!;
    const notes = within(guestsCell).getByText("Llega tarde");
    expect(notes.className).toContain("admin-muted");
    const list = guestsCell.querySelector("ul")!;
    expect(list.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders no notes element when there are no notes", () => {
    render(<GuestTable rows={[guestRow({ notes: null })]} emptyText="" />);

    expect(cellsOf(bodyRows()[0]!)[1]!.querySelector("p")).toBeNull();
  });
});

describe("GuestTable allergies", () => {
  it("highlights the allergies with a badge and a stronger colored text", () => {
    render(<GuestTable rows={[guestRow({ allergies: "Maní y mariscos" })]} emptyText="" />);

    const allergiesCell = cellsOf(bodyRows()[0]!)[3]!;
    const badge = within(allergiesCell).getByText("Alergias");
    expect(badge.getAttribute("data-slot")).toBe("badge");
    expect(badge.getAttribute("data-variant")).toBe("rejected");
    const text = within(allergiesCell).getByText("Maní y mariscos");
    expect(text.className).toContain("text-destructive");
    expect(text.className).toContain("font-semibold");
  });

  it("shows No without a badge when there are no allergies", () => {
    render(<GuestTable rows={[guestRow({ allergies: null })]} emptyText="" />);

    const allergiesCell = cellsOf(bodyRows()[0]!)[3]!;
    expect(allergiesCell.textContent).toBe("No");
    expect(within(allergiesCell).queryByText("Alergias")).toBeNull();
  });
});

describe("GuestTable status and message", () => {
  it("shows the extra badge next to the status only when present", () => {
    render(
      <GuestTable
        rows={[
          guestRow({
            key: "with-extra",
            extra: { label: "Reembolso pendiente", variant: "cancelled" },
          }),
          guestRow({ key: "without-extra" }),
        ]}
        emptyText=""
      />,
    );

    const [withExtra, withoutExtra] = bodyRows();
    const extra = within(cellsOf(withExtra!)[4]!).getByText("Reembolso pendiente");
    expect(extra.getAttribute("data-variant")).toBe("cancelled");
    expect(within(cellsOf(withoutExtra!)[4]!).queryByText("Reembolso pendiente")).toBeNull();
    expect(cellsOf(withoutExtra!)[4]!.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
  });

  it("shows the message badge with its tooltip", () => {
    render(
      <GuestTable
        rows={[
          guestRow({
            message: {
              label: "Pendiente",
              variant: "draft",
              title: "Todavía no nos ha escrito por Instagram.",
            },
          }),
        ]}
        emptyText=""
      />,
    );

    const badge = within(cellsOf(bodyRows()[0]!)[5]!).getByText("Pendiente");
    expect(badge.getAttribute("data-variant")).toBe("draft");
    expect(badge.getAttribute("title")).toBe("Todavía no nos ha escrito por Instagram.");
  });

  it("shows the message badge without a tooltip when no title is given", () => {
    render(
      <GuestTable
        rows={[guestRow({ message: { label: "Enviado", variant: "confirmed" } })]}
        emptyText=""
      />,
    );

    const badge = within(cellsOf(bodyRows()[0]!)[5]!).getByText("Enviado");
    expect(badge.hasAttribute("title")).toBe(false);
  });

  it("shows a dash when the request has no message", () => {
    render(<GuestTable rows={[guestRow({ message: null })]} emptyText="" />);

    const messageCell = cellsOf(bodyRows()[0]!)[5]!;
    expect(messageCell.textContent).toBe("-");
    expect(messageCell.querySelector('[data-slot="badge"]')).toBeNull();
  });
});

describe("GuestTable actions column", () => {
  it("renders the detail and the actions in the last cell", () => {
    render(
      <GuestTable
        rows={[
          guestRow({
            detail: <button type="button">Ver ficha</button>,
            actions: <button type="button">Aceptar</button>,
          }),
        ]}
        emptyText=""
      />,
    );

    const actionsCell = cellsOf(bodyRows()[0]!)[7]!;
    expect(within(actionsCell).getByRole("button", { name: "Ver ficha" })).toBeDefined();
    expect(within(actionsCell).getByRole("button", { name: "Aceptar" })).toBeDefined();
  });

  it("renders no buttons when detail and actions are null", () => {
    render(<GuestTable rows={[guestRow({ detail: null, actions: null })]} emptyText="" />);

    expect(within(cellsOf(bodyRows()[0]!)[7]!).queryByRole("button")).toBeNull();
  });
});

describe("GuestTable rows", () => {
  it("renders one row per request in the given order", () => {
    render(
      <GuestTable
        rows={[
          guestRow({ key: "a", numberLabel: "#001" }),
          guestRow({ key: "b", numberLabel: "#002" }),
          guestRow({ key: "c", numberLabel: "Cola #1" }),
        ]}
        emptyText=""
      />,
    );

    expect(bodyRows().map((row) => cellsOf(row)[0]!.textContent)).toEqual([
      "#001",
      "#002",
      "Cola #1",
    ]);
  });

  it("uses the same staggered entrance animation as the current roster", () => {
    const rows = Array.from({ length: 14 }, (_, index) =>
      guestRow({ key: `request-${index}`, numberLabel: `#${index}` }),
    );
    render(<GuestTable rows={rows} emptyText="" />);

    const rendered = bodyRows();
    expect(rendered[0]!.className).toContain("animate-in");
    expect(rendered[0]!.className).toContain("fade-in-0");
    expect(rendered[0]!.className).toContain("slide-in-from-bottom-1");
    expect(rendered[0]!.style.animationDelay).toBe("0ms");
    expect(rendered[3]!.style.animationDelay).toBe("90ms");
    expect(rendered[13]!.style.animationDelay).toBe("360ms");
  });

  it("aligns the cells of a row to the top", () => {
    render(<GuestTable rows={[guestRow()]} emptyText="" />);

    expect(bodyRows()[0]!.className).toContain("[&>td]:align-top");
  });
});
