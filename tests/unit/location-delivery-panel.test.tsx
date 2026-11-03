// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { LocationDeliverySummary } from "@/application/events/location-message-repository";
import type { RecipientGroup } from "@/application/messaging/recipient-groups";
import { LocationDeliveryPanel } from "@/ui/admin/location-delivery-panel";

vi.mock("next/link", () => ({
  default: ({ href, ...props }: ComponentProps<"a">) => <a href={href} {...props} />,
}));

afterEach(cleanup);

const everyoneHasIt: LocationDeliverySummary = {
  paid: 8,
  received: 8,
  pending: 0,
  failed: 0,
  neverQueued: 0,
  outdated: 0,
  lastDeliveredAt: null,
};

const reservationId = "11111111-1111-4111-8111-111111111111";

const recipients: RecipientGroup[] = [
  {
    reservationId,
    reservationNumber: 1,
    people: [
      { slot: 1, name: "Ana", instagram: "ana", linked: true, statusByItem: { "3": "NOT_SENT" } },
    ],
  },
];

const explanation =
  "Quien quede confirmado con la ubicación lista la recibe automáticamente por Instagram. Si alguien no nos ha escrito en las últimas 24 horas, el mensaje queda pendiente hasta que escriba, o puedes enviarlo a mano desde Mensajes.";

function panel(
  summary: Partial<LocationDeliverySummary> = {},
  props: Partial<ComponentProps<typeof LocationDeliveryPanel>> = {},
) {
  return (
    <LocationDeliveryPanel
      summary={{ ...everyoneHasIt, ...summary }}
      locationConfirmed
      acceptsSends
      recipients={recipients}
      currentRevision={3}
      sendAction={vi.fn(async () => ({ ok: true, message: "Enviada." }))}
      sendToPeopleAction={vi.fn(async () => ({ ok: true, message: "Enviada." }))}
      {...props}
    />
  );
}

describe("LocationDeliveryPanel summary", () => {
  it("shows the four counts on one line", () => {
    render(panel({ paid: 10, received: 6, pending: 3, failed: 1, neverQueued: 0 }));

    expect(
      screen.getByText(
        "Confirmados: 10 · Tienen la ubicación actual: 6 · Pendientes: 3 · Fallidos: 1",
      ),
    ).toBeDefined();
  });

  it("always explains the automatic delivery and the 24 hour window", () => {
    render(panel());

    expect(screen.getByText(explanation)).toBeDefined();
  });

  it("shows the last delivery time when somebody already received the location", () => {
    render(panel({ lastDeliveredAt: new Date("2026-10-05T18:30:00Z") }));

    expect(screen.getByText("Última entrega: 05/10/2026 12:30")).toBeDefined();
  });

  it("omits the last delivery line when nobody received it yet", () => {
    render(panel());

    expect(screen.queryByText(/Última entrega/)).toBeNull();
  });
});

describe("LocationDeliveryPanel send dialog", () => {
  it("offers the send dialog when the location is confirmed", () => {
    render(panel());

    expect(screen.getByRole("button", { name: "Enviar ubicación" })).toBeDefined();
  });

  it("lists the people grouped by reservation", async () => {
    render(panel());

    fireEvent.click(screen.getByRole("button", { name: "Enviar ubicación" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("#001");
    expect(dialog.textContent).toContain("Ana");
    expect(dialog.textContent).toContain("Se enviará a 1 personas que aún no lo tienen.");
  });

  it("runs the send-all action from the dialog", async () => {
    const sendAction = vi.fn(async () => ({
      ok: true,
      message: "Ubicación enviada a 1 persona.",
    }));
    render(panel({}, { sendAction }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ubicación" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar a todos (1)" }));

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Ubicación enviada a 1 persona.",
    );
  });

  it("sends only the chosen people with their keys", async () => {
    const sendToPeopleAction = vi.fn(async (_state: AdminActionState, formData: FormData) => ({
      ok: true,
      message: `Enviada a ${formData.getAll("people").length}.`,
    }));
    render(panel({}, { sendToPeopleAction }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ubicación" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Elegir" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Elegir Ana" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar a seleccionados (1)" }));

    await waitFor(() => expect(sendToPeopleAction).toHaveBeenCalledTimes(1));
    const formData = sendToPeopleAction.mock.calls[0]![1];
    expect(formData.getAll("people")).toEqual([`${reservationId}:1`]);
  });

  it("shows an error in the dialog when the send fails", async () => {
    const sendAction = vi.fn(async () => ({
      ok: false,
      message: "Confirma la ubicación antes de enviarla.",
    }));
    render(panel({}, { sendAction }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ubicación" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enviar a todos (1)" }));

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Confirma la ubicación antes de enviarla.",
    );
  });
});

describe("LocationDeliveryPanel pending link", () => {
  it.each([
    [{ pending: 2 }, true],
    [{ failed: 1 }, true],
    [{ pending: 1, failed: 1 }, true],
    [{}, false],
  ])("for %j the link to Mensajes is shown: %s", (summary, shown) => {
    render(panel(summary));

    const link = screen.queryByRole("link", { name: "Ver pendientes en Mensajes" });
    expect(link !== null).toBe(shown);
    if (link) expect(link.getAttribute("href")).toBe("/admin/mensajes");
  });
});

describe("LocationDeliveryPanel with an unconfirmed location", () => {
  it("asks to confirm the location and offers no send even if guests lack it", () => {
    render(panel({ paid: 8, received: 0, neverQueued: 8 }, { locationConfirmed: false }));

    expect(screen.getByText("Confirma la ubicación para poder enviarla.")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(explanation)).toBeDefined();
  });

  it("offers no send for a cancelled or completed experience", () => {
    render(panel({ paid: 8, received: 0, neverQueued: 8 }, { acceptsSends: false }));

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(explanation)).toBeDefined();
  });

  it("does not ask to confirm once the location is confirmed", () => {
    render(panel());

    expect(screen.queryByText("Confirma la ubicación para poder enviarla.")).toBeNull();
  });
});
