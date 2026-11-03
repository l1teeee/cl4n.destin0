// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { EventEconomy } from "@/application/economy/economy-repository";
import type { PickerItem } from "@/application/extras/extra-repository";
import type { EconomyHandlers } from "@/ui/admin/economy/economy-handlers";
import { EventEconomySection } from "@/ui/admin/economy/event-economy-section";

const eventId = "00000000-0000-4000-8000-0000000000e1";
const coupleId = "00000000-0000-4000-8000-0000000000a1";
const soloId = "00000000-0000-4000-8000-0000000000a2";
const lineId = "00000000-0000-4000-8000-0000000000b1";
const drinkId = "00000000-0000-4000-8000-0000000000d1";
const extraId = "00000000-0000-4000-8000-0000000000c1";

const drinks: PickerItem[] = [{ id: drinkId, name: "Vino", priceCents: 450 }];
const extras: PickerItem[] = [{ id: extraId, name: "Pan", priceCents: 300 }];

function economy(): EventEconomy {
  return {
    eventTotalCents: 1350,
    guests: [
      {
        reservationId: coupleId,
        reservationNumber: 1,
        slot: 1,
        fullName: "Ana López",
        instagram: "ana.lopez",
        stage: "PAID",
        totalCents: 900,
        settled: false,
        settledAt: null,
        lines: [
          {
            id: lineId,
            source: "DRINK",
            itemName: "Vino",
            unitPriceCents: 450,
            quantity: 2,
            totalCents: 900,
            createdAt: new Date("2026-11-01T02:30:00Z"),
            voidedAt: null,
          },
          {
            id: "00000000-0000-4000-8000-0000000000b2",
            source: "CUSTOM",
            itemName: "Postre erróneo",
            unitPriceCents: 500,
            quantity: 1,
            totalCents: 500,
            createdAt: new Date("2026-11-01T02:40:00Z"),
            voidedAt: new Date("2026-11-01T02:45:00Z"),
          },
        ],
      },
      {
        reservationId: coupleId,
        reservationNumber: 1,
        slot: 2,
        fullName: "Beto Cliente",
        instagram: "beto.c",
        stage: "PAID",
        totalCents: 0,
        settled: true,
        settledAt: new Date("2026-11-01T03:00:00Z"),
        lines: [],
      },
      {
        reservationId: soloId,
        reservationNumber: 2,
        slot: 1,
        fullName: "Marta Solis",
        instagram: "marta.s",
        stage: "ON_LIST",
        totalCents: 450,
        settled: false,
        settledAt: null,
        lines: [],
      },
    ],
  };
}

function handlersFor(): { [K in keyof EconomyHandlers]: ReturnType<typeof vi.fn> } {
  return {
    add: vi.fn().mockResolvedValue({ ok: true, message: "Consumo agregado." }),
    voidLine: vi.fn().mockResolvedValue({ ok: true, message: "Consumo anulado." }),
    settle: vi.fn().mockResolvedValue({ ok: true, message: "Cuenta marcada como pagada." }),
    reopen: vi.fn().mockResolvedValue({ ok: true, message: "Cuenta reabierta." }),
    sendTab: vi.fn(),
    sendGroupTabs: vi.fn(),
  };
}

function renderSection(
  handlers = handlersFor(),
  data: EventEconomy = economy(),
  props: { drinks?: PickerItem[]; extras?: PickerItem[] } = {},
) {
  render(
    <EventEconomySection
      eventId={eventId}
      economy={data}
      drinks={props.drinks ?? drinks}
      extras={props.extras ?? extras}
      tabPreviews={[]}
      handlers={handlers as unknown as EconomyHandlers}
    />,
  );
  return handlers;
}

function openGuest(name: RegExp): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(cleanup);

describe("EventEconomySection", () => {
  it("shows the event total, the counts and one row per guest tab", () => {
    renderSection();

    expect(screen.getByLabelText("Total de la experiencia").textContent).toContain("13.50");
    expect(screen.getByText("3 invitados · 1 pagado")).toBeDefined();
    expect(screen.getByRole("button", { name: /#001 · Ana López · @ana\.lopez/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /#001 · Beto Cliente · @beto\.c/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /#002 · Marta Solis/ })).toBeDefined();
  });

  it("shows the empty state when nobody is on the list", () => {
    renderSection(handlersFor(), { eventTotalCents: 0, guests: [] });

    expect(screen.getByText("Todavía no hay invitados en la lista o pagados.")).toBeDefined();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("filters pending and paid tabs and searches by name or Instagram", () => {
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Pagados" }));
    expect(screen.queryByRole("button", { name: /Ana López/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Beto Cliente/ })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Pendientes" }));
    expect(screen.queryByRole("button", { name: /Beto Cliente/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Marta Solis/ })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    fireEvent.change(screen.getByLabelText("Buscar invitado"), { target: { value: "@marta" } });
    expect(screen.queryByRole("button", { name: /Ana López/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Marta Solis/ })).toBeDefined();

    fireEvent.change(screen.getByLabelText("Buscar invitado"), { target: { value: "zzz" } });
    expect(screen.getByText("Ningún invitado coincide con la búsqueda.")).toBeDefined();
  });

  it("adds a catalog item with one tap using the chosen quantity", async () => {
    const handlers = renderSection();
    openGuest(/Ana López/);

    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Más" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Más" }));
    fireEvent.click(within(sheet).getByRole("button", { name: /^Vino · / }));

    await waitFor(() => expect(handlers.add).toHaveBeenCalledTimes(1));
    const [calledEventId, reservationId, slot, , formData] = handlers.add.mock.calls[0] as [
      string,
      string,
      number,
      AdminActionState,
      FormData,
    ];
    expect([calledEventId, reservationId, slot]).toEqual([eventId, coupleId, 1]);
    expect(Object.fromEntries(formData.entries())).toEqual({
      source: "DRINK",
      itemId: drinkId,
      quantity: "3",
    });
    expect((await within(sheet).findByRole("status")).textContent).toContain("Consumo agregado.");
    expect(within(sheet).getByRole("status").textContent).not.toContain("Error");
    expect(within(sheet).getByRole("group", { name: "Cantidad" }).textContent).toContain("1");
  });

  it("adds an extra for the second guest of a couple", async () => {
    const handlers = renderSection();
    openGuest(/Beto Cliente/);

    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /^Pan · / }));

    await waitFor(() => expect(handlers.add).toHaveBeenCalledTimes(1));
    const call = handlers.add.mock.calls[0] as [string, string, number, AdminActionState, FormData];
    expect([call[1], call[2]]).toEqual([coupleId, 2]);
    expect(call[4].get("source")).toBe("EXTRA");
    expect(call[4].get("itemId")).toBe(extraId);
  });

  it("sends a custom item and shows field errors from the action", async () => {
    const handlers = handlersFor();
    handlers.add.mockResolvedValueOnce({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { customName: "El nombre es obligatorio." },
    });
    renderSection(handlers);
    openGuest(/Marta Solis/);

    const sheet = await screen.findByRole("dialog");
    const form = within(sheet).getByRole("form", { name: "Otro consumo" });
    fireEvent.submit(form);
    expect(await within(sheet).findByText("El nombre es obligatorio.")).toBeDefined();

    fireEvent.change(within(form).getByLabelText(/^Nombre/), { target: { value: "Postre" } });
    fireEvent.change(within(form).getByLabelText(/^Precio/), { target: { value: "4.50" } });
    fireEvent.submit(form);

    await waitFor(() => expect(handlers.add).toHaveBeenCalledTimes(2));
    const sent = (
      handlers.add.mock.calls[1] as [string, string, number, AdminActionState, FormData]
    )[4];
    expect(Object.fromEntries(sent.entries())).toEqual({
      customName: "Postre",
      customPrice: "4.50",
      quantity: "1",
      source: "CUSTOM",
    });
  });

  it("lists the lines with voided ones muted and the tab total", async () => {
    renderSection();
    openGuest(/Ana López/);

    const sheet = await screen.findByRole("dialog");
    const voided = within(sheet).getByText("Postre erróneo").closest("li")!;
    expect(voided.getAttribute("data-voided")).toBe("true");
    expect(within(voided).queryByRole("button", { name: /Anular/ })).toBeNull();
    const active = sheet.querySelector('li[data-voided="false"]')!;
    expect(active.textContent).toContain("2 × ");
    expect(active.textContent).toContain("9.00");
    expect(within(sheet).getByText("Total de la cuenta").parentElement!.textContent).toContain(
      "9.00",
    );
  });

  it("shows an empty state for a tab without lines", async () => {
    renderSection();
    openGuest(/Beto Cliente/);

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Sin consumos todavía.")).toBeDefined();
  });

  it("voids a line only after confirming", async () => {
    const handlers = renderSection();
    openGuest(/Ana López/);

    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /Anular Vino/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("¿Anular este consumo?")).toBeDefined();
    expect(handlers.voidLine).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(handlers.voidLine).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole("button", { name: /Anular Vino/ }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Anular consumo",
      }),
    );

    await waitFor(() => expect(handlers.voidLine).toHaveBeenCalledTimes(1));
    expect((handlers.voidLine.mock.calls[0] as unknown[]).slice(0, 2)).toEqual([eventId, lineId]);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("marks a tab as paid with one tap", async () => {
    const handlers = renderSection();
    openGuest(/Marta Solis/);

    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Marcar pagado" }));

    await waitFor(() => expect(handlers.settle).toHaveBeenCalledTimes(1));
    expect((handlers.settle.mock.calls[0] as unknown[]).slice(0, 3)).toEqual([eventId, soloId, 1]);
    expect(handlers.reopen).not.toHaveBeenCalled();
  });

  it("asks before reopening a settled tab", async () => {
    const handlers = renderSection();
    openGuest(/Beto Cliente/);

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByRole("button", { name: "Marcar pagado" })).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "Reabrir cuenta" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("¿Reabrir la cuenta?")).toBeDefined();
    expect(handlers.reopen).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar reapertura" }));

    await waitFor(() => expect(handlers.reopen).toHaveBeenCalledTimes(1));
    expect((handlers.reopen.mock.calls[0] as unknown[]).slice(0, 3)).toEqual([
      eventId,
      coupleId,
      2,
    ]);
  });

  it("keeps the sheet open on the same guest when new data arrives", async () => {
    const handlers = handlersFor();
    const { rerender } = render(
      <EventEconomySection
        eventId={eventId}
        economy={economy()}
        drinks={drinks}
        extras={extras}
        tabPreviews={[]}
        handlers={handlers as unknown as EconomyHandlers}
      />,
    );
    openGuest(/Marta Solis/);
    const sheet = await screen.findByRole("dialog");

    const updated = economy();
    updated.guests[2]!.settled = true;
    rerender(
      <EventEconomySection
        eventId={eventId}
        economy={updated}
        drinks={drinks}
        extras={extras}
        tabPreviews={[]}
        handlers={handlers as unknown as EconomyHandlers}
      />,
    );

    expect(within(sheet).getByRole("button", { name: "Reabrir cuenta" })).toBeDefined();
    expect(within(sheet).getByText("#002 · Marta Solis · @marta.s")).toBeDefined();
  });

  it("explains when there are no drinks or extras to pick", async () => {
    renderSection(handlersFor(), economy(), { drinks: [], extras: [] });
    openGuest(/Marta Solis/);

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("No hay bebidas en el menú.")).toBeDefined();
    expect(within(sheet).getByText("No hay extras disponibles.")).toBeDefined();
  });
});
