// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EventClue } from "@/application/events/event-clue-repository";
import type { RecipientGroup } from "@/application/messaging/recipient-groups";
import { EventCluesSection } from "@/ui/admin/event-clues-section";
import { TooltipProvider } from "@/ui/primitives/tooltip";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

vi.mock("@/app/admin/(protected)/events/actions", () => ({
  deleteEventClueAction: vi.fn(async () => ({ ok: true, message: "Pista eliminada." })),
  sendClueToAllAction: vi.fn(async () => ({ ok: true, message: "Pista enviada." })),
  sendClueToPeopleAction: vi.fn(async () => ({ ok: true, message: "Pista enviada." })),
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

type Status = "NOT_SENT" | "SENT" | "PENDING" | "FAILED";

function person(slot: 1 | 2, statuses: readonly [Status, Status, Status]) {
  return {
    slot,
    name: `Persona ${slot}`,
    instagram: `persona${slot}`,
    linked: true,
    statusByItem: { "clue-1": statuses[0], "clue-2": statuses[1], "clue-3": statuses[2] },
  };
}

const recipients: RecipientGroup[] = [
  {
    reservationId: "11111111-1111-4111-8111-111111111111",
    reservationNumber: 1,
    people: [person(1, ["SENT", "SENT", "SENT"]), person(2, ["SENT", "SENT", "PENDING"])],
  },
  {
    reservationId: "22222222-2222-4222-8222-222222222222",
    reservationNumber: 2,
    people: [person(1, ["SENT", "SENT", "FAILED"]), person(2, ["SENT", "PENDING", "FAILED"])],
  },
  {
    reservationId: "33333333-3333-4333-8333-333333333333",
    reservationNumber: 3,
    people: [person(1, ["SENT", "PENDING", "SENT"])],
  },
];

function section(overrides: Partial<ComponentProps<typeof EventCluesSection>> = {}) {
  return (
    <TooltipProvider>
      <EventCluesSection
        clues={clues}
        recipients={recipients}
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

  it("shows how far each clue got among the paid guests", () => {
    render(section());

    const items = screen.getAllByRole("listitem");
    expect(within(items[2]!).getByText("Enviada a 5 de 5 · 0 pendientes")).toBeDefined();
    expect(within(items[1]!).getByText("Enviada a 3 de 5 · 2 pendientes")).toBeDefined();
    expect(
      within(items[0]!).getByText("Enviada a 2 de 5 · 1 pendiente · 2 fallidos"),
    ).toBeDefined();
  });

  it("uses the singular for exactly one failed message", () => {
    render(
      section({
        clues: [clues[0]!],
        recipients: [
          {
            reservationId: "44444444-4444-4444-8444-444444444444",
            reservationNumber: 4,
            people: [
              person(1, ["SENT", "SENT", "SENT"]),
              person(2, ["SENT", "SENT", "SENT"]),
              person(1, ["SENT", "SENT", "SENT"]),
              person(2, ["FAILED", "SENT", "SENT"]),
            ],
          },
        ],
      }),
    );

    expect(screen.getByText("Enviada a 3 de 4 · 0 pendientes · 1 fallido")).toBeDefined();
  });

  it("says the clue is ready to send when nobody has received it", () => {
    render(section({ recipients: [] }));

    expect(screen.getAllByText("Lista para enviar")).toHaveLength(3);
    expect(screen.queryByText(/Enviada a/)).toBeNull();
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

  it("offers the publish form, a send button and a delete button per clue", () => {
    render(section());

    expect(screen.getByRole("heading", { name: "Pistas" })).toBeDefined();
    expect(
      screen.getByText(
        "Genera la pista con texto e imágenes; queda lista para enviar. Envíala por Instagram a todos los que vienen o a quienes elijas.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Generar pista" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Enviar" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Eliminar pista" })).toHaveLength(3);
    expect(screen.queryByRole("link", { name: "Vista previa pública" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver enlace de pistas" })).toBeNull();
  });

  it("provides clue text and optional image fields", () => {
    render(section());

    const textarea = screen.getByRole("textbox", { name: "Pista" }) as HTMLTextAreaElement;
    expect(textarea.name).toBe("body");
    expect(textarea.maxLength).toBe(500);
    expect(textarea.required).toBe(true);
    expect(screen.getByLabelText(/Imágenes/).getAttribute("multiple")).not.toBeNull();
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
      within(dialog).getByText(
        "La pista se eliminará. Los mensajes ya enviados no se borran de Instagram.",
      ),
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
    expect(screen.queryByRole("button", { name: "Enviar" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Vista previa pública" })).toBeNull();
  });

  it("shows the empty state without a publish form", () => {
    render(section({ phase: "COMPLETED", clues: [] }));

    expect(screen.getByText("Todavía no hay pistas.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Generar pista" })).toBeNull();
  });
});
