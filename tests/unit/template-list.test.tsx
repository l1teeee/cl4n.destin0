// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TemplateList } from "@/ui/admin/messages/template-list";
import {
  filterTemplates,
  groupTemplates,
  type TemplateListItem,
} from "@/ui/admin/messages/template-list-view";

afterEach(cleanup);

function item(overrides: Partial<TemplateListItem> & Pick<TemplateListItem, "key">) {
  return {
    title: "Plantilla",
    timing: "Cuando pasa algo",
    body: "Texto",
    variables: ["nombre"],
    editedLabel: "Editado 14/11/2026 10:00",
    updatedLabel: "Última edición: 14/11/2026 10:00 por Ana",
    ...overrides,
  } satisfies TemplateListItem;
}

const items: TemplateListItem[] = [
  item({
    key: "WAITLISTED",
    title: "En la cola",
    timing: "Cuando nos escribe y quedó en la cola",
    body: "Hola {nombre}\nSigues en la cola.",
  }),
  item({
    key: "PAID",
    title: "Pago verificado",
    timing: "Al verificar el pago",
    body: "Tu lugar está confirmado.",
  }),
  item({
    key: "LOCATION",
    title: "Ubicación",
    timing: "Al enviar la ubicación",
    body: "Nos vemos en la dirección.",
  }),
];

function renderList(readOnly = false) {
  return render(
    <TemplateList
      items={items}
      readOnly={readOnly}
      action={vi.fn(async () => ({ ok: true, message: "Guardada." }))}
    />,
  );
}

describe("template list view", () => {
  it("matches title, timing and text without case or accents", () => {
    expect(filterTemplates(items, "UBICACION").map((entry) => entry.key)).toEqual(["LOCATION"]);
    expect(filterTemplates(items, "verificar").map((entry) => entry.key)).toEqual(["PAID"]);
    expect(filterTemplates(items, "esta confirmado").map((entry) => entry.key)).toEqual(["PAID"]);
    expect(filterTemplates(items, "  hola ").map((entry) => entry.key)).toEqual(["WAITLISTED"]);
    expect(filterTemplates(items, "")).toHaveLength(3);
  });

  it("groups by moment in a fixed order and sends unmapped keys to Otros", () => {
    const groups = groupTemplates(items);

    expect(groups.map((group) => group.title)).toEqual([
      "Solicitud y cola",
      "Lista y pago",
      "Ubicación y pistas",
    ]);

    const unmapped = groupTemplates([item({ key: "SURPRISE" as TemplateListItem["key"] })]);
    expect(unmapped.map((group) => group.title)).toEqual(["Otros"]);
  });
});

describe("TemplateList", () => {
  it("filters the rows as the query changes, ignoring accents", () => {
    renderList();

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar plantilla" }), {
      target: { value: "ubicacion" },
    });

    expect(screen.getByRole("button", { name: /Ubicación/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Pago verificado/ })).toBeNull();
  });

  it("explains an empty result", () => {
    renderList();

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar plantilla" }), {
      target: { value: "zzz" },
    });

    expect(screen.getByText("No hay plantillas con «zzz».")).toBeDefined();
  });

  it("starts collapsed and shows the first line of the text", () => {
    renderList();

    for (const name of [/En la cola/, /Pago verificado/, /Ubicación/]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.getByText("Hola {nombre}")).toBeDefined();
  });

  it("keeps a single template open at a time", () => {
    renderList();
    const queue = screen.getByRole("button", { name: /En la cola/ });
    const paid = screen.getByRole("button", { name: /Pago verificado/ });

    fireEvent.click(queue);
    expect(queue.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(paid);
    expect(queue.getAttribute("aria-expanded")).toBe("false");
    expect(paid.getAttribute("aria-expanded")).toBe("true");
  });

  it("collapses with a second click or Escape", () => {
    renderList();
    const queue = screen.getByRole("button", { name: /En la cola/ });

    fireEvent.click(queue);
    fireEvent.click(queue);
    expect(queue.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(queue);
    fireEvent.keyDown(screen.getByLabelText("Texto de En la cola"), { key: "Escape" });
    expect(queue.getAttribute("aria-expanded")).toBe("false");
  });
});
