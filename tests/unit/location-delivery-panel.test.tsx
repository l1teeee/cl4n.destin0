// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocationDeliverySummary } from "@/application/events/location-message-repository";
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
      sendAction={vi.fn(async () => ({ ok: true, message: "Enviada." }))}
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

describe("LocationDeliveryPanel send button", () => {
  it("offers the first send when some confirmed guests never got the location", () => {
    render(panel({ paid: 8, received: 5, neverQueued: 3 }));

    expect(
      screen.getByRole("button", { name: "Enviar ubicación a confirmados (3)" }),
    ).toBeDefined();
  });

  it("offers the updated send when only outdated guests remain", () => {
    render(panel({ paid: 8, received: 5, outdated: 3 }));

    expect(screen.getByRole("button", { name: "Enviar ubicación actualizada (3)" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /a confirmados/ })).toBeNull();
  });

  it("keeps the first-send label and counts everybody the send will reach", () => {
    render(panel({ paid: 10, received: 4, neverQueued: 2, outdated: 3, failed: 1 }));

    expect(
      screen.getByRole("button", { name: "Enviar ubicación a confirmados (6)" }),
    ).toBeDefined();
  });

  it("offers a retry for failed guests only", () => {
    render(panel({ paid: 8, received: 6, failed: 2 }));

    expect(
      screen.getByRole("button", { name: "Enviar ubicación a confirmados (2)" }),
    ).toBeDefined();
  });

  it("hides the button when everyone has the current location", () => {
    render(panel());

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides the button when the rest is only waiting for Instagram", () => {
    render(panel({ paid: 8, received: 5, pending: 3 }));

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks for confirmation and says how many people receive it", async () => {
    render(panel({ paid: 8, received: 5, neverQueued: 3 }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ubicación a confirmados (3)" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("La ubicación se enviará por Instagram a 3 personas.");
  });

  it("uses the singular in the confirmation for one person", async () => {
    render(panel({ paid: 8, received: 7, outdated: 1 }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ubicación actualizada (1)" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("La ubicación se enviará por Instagram a 1 persona.");
  });

  it("runs the send action only after the confirmation", async () => {
    const sendAction = vi.fn(async () => ({
      ok: true,
      message: "Ubicación enviada a 3 personas.",
    }));
    render(panel({ paid: 8, received: 5, neverQueued: 3 }, { sendAction }));

    fireEvent.click(screen.getByRole("button", { name: "Enviar ubicación a confirmados (3)" }));
    expect(sendAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === "Enviar ubicación a confirmados (3)",
    )!;
    fireEvent.click(confirm);

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Ubicación enviada a 3 personas.",
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
