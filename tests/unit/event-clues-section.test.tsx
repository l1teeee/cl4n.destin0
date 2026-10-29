// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EventClue } from "@/application/events/event-clue-repository";
import { EventCluesSection } from "@/ui/admin/event-clues-section";
import { TooltipProvider } from "@/ui/primitives/tooltip";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

vi.mock("@/app/admin/(protected)/events/actions", () => ({
  deleteEventClueAction: vi.fn(async () => ({ ok: true, message: "Pista eliminada." })),
}));

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

const clues: EventClue[] = [
  { id: "clue-1", body: "Primera pista", createdAt: new Date("2026-10-28T20:00:00Z"), images: [] },
  { id: "clue-2", body: "Segunda\npista", createdAt: new Date("2026-10-28T21:30:00Z"), images: [] },
  { id: "clue-3", body: "Tercera pista", createdAt: new Date("2026-10-28T22:45:00Z"), images: [] },
];

function section(overrides: Partial<ComponentProps<typeof EventCluesSection>> = {}) {
  return (
    <TooltipProvider>
      <EventCluesSection
        appBaseUrl="https://clandestino.example/"
        clues={clues}
        eventId="event-1"
        phase="CLOSED"
        slug="cena privada"
        {...overrides}
      />
    </TooltipProvider>
  );
}

describe("EventCluesSection while the experience is closed", () => {
  it("lists the newest clue first with chronological numbers and dates", () => {
    render(section());

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("summary span span")?.textContent)).toEqual([
      "Pista 3",
      "Pista 2",
      "Pista 1",
    ]);
    expect(within(items[0]!).getByText("Tercera pista")).toBeDefined();
    expect(within(items[0]!).getByText("28/10/2026 16:45")).toBeDefined();
    expect(within(items[2]!).getByText("Primera pista")).toBeDefined();
  });

  it("reveals and hides a clue when its heading is clicked", () => {
    render(section());

    const item = screen.getAllByRole("listitem")[2]!;
    const details = item.querySelector("details")!;
    const summary = item.querySelector("summary")!;
    expect(summary.textContent).toContain("Pista 1");
    expect(details.open).toBe(false);

    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(within(item).getByText("Primera pista")).toBeDefined();

    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it("offers the publish form, the clues link and one delete button per clue", () => {
    render(section());

    expect(screen.getByRole("heading", { name: "Pistas" })).toBeDefined();
    expect(
      screen.getByText(
        "Los comensales ven las pistas en la página de pistas. Una pista nueva aparece ahí en menos de un minuto.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Ver enlace de pistas" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Generar pista" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Eliminar pista" })).toHaveLength(3);
  });

  it("reveals the public clues URL", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    render(section());

    fireEvent.click(screen.getByRole("button", { name: "Ver enlace de pistas" }));

    expect(
      (screen.getByRole("textbox", { name: "Enlace público" }) as HTMLInputElement).value,
    ).toBe("https://clandestino.example/pistas/cena%20privada");
    await screen.findByText("Enlace copiado.");
  });

  it("provides clue text and optional image fields", () => {
    render(section());

    const textarea = screen.getByRole("textbox", { name: "Pista" }) as HTMLTextAreaElement;
    expect(textarea.name).toBe("body");
    expect(textarea.maxLength).toBe(500);
    expect(textarea.required).toBe(true);
    expect(screen.getByLabelText(/Imágenes/).getAttribute("multiple")).not.toBeNull();
    const preview = screen.getByRole("link", { name: "Vista previa pública" });
    expect(preview.getAttribute("href")).toBe("https://clandestino.example/pistas/cena%20privada");
    expect(preview.getAttribute("target")).toBe("_blank");
    expect(preview.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows the empty state when there are no clues", () => {
    render(section({ clues: [] }));

    expect(screen.getByText("Todavía no hay pistas.")).toBeDefined();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByRole("button", { name: "Generar pista" })).toBeDefined();
  });

  it("keeps the confirmation after the last clue is deleted", async () => {
    const view = render(section({ clues: [clues[0]!] }));

    fireEvent.click(screen.getByRole("button", { name: "Eliminar pista" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("La pista dejará de verse en la página de pistas."),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar pista" }));
    await screen.findByText("Pista eliminada.");

    view.rerender(section({ clues: [] }));

    expect(screen.getByText("Pista eliminada.")).toBeDefined();
    expect(screen.getByText("Todavía no hay pistas.")).toBeDefined();
  });

  it("shows attached clue images in the admin history", () => {
    render(section({ clues: [{ ...clues[0]!, images: [{ id: "image-1" }] }] }));
    const image = screen.getByAltText("Imagen 1 adjunta a la pista 1");
    expect(image.getAttribute("src")).toBe("/pistas/cena%20privada/imagenes/image-1");
  });
});

describe("EventCluesSection after the experience is completed", () => {
  it("keeps the clues as a read-only record", () => {
    render(section({ phase: "COMPLETED" }));

    expect(
      screen.getByText("La experiencia terminó. Las pistas quedan como registro."),
    ).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Generar pista" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar pista" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ver enlace de pistas" })).toBeDefined();
  });

  it("shows the empty state without a publish form", () => {
    render(section({ phase: "COMPLETED", clues: [] }));

    expect(screen.getByText("Todavía no hay pistas.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Generar pista" })).toBeNull();
  });
});
