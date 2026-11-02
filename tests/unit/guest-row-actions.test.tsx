// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type {
  EventGuestRow,
  PromotionPreview,
} from "@/infrastructure/db/repositories/event-guest-queries";
import type { GuestActionHandlers } from "@/ui/admin/guests/guest-action-handlers";
import { GuestRowActions } from "@/ui/admin/guests/guest-row-actions";
import { TooltipProvider } from "@/ui/primitives/tooltip";

afterEach(cleanup);

const rowId = "11111111-1111-4111-8111-111111111111";
const oneSeatId = "22222222-2222-4222-8222-222222222222";
const twoSeatsId = "33333333-3333-4333-8333-333333333333";
const couplesId = "44444444-4444-4444-8444-444444444444";

const preview: PromotionPreview = {
  waitingCount: 2,
  oneSeat: [{ id: oneSeatId, guests: ["Luis"] }],
  twoSeats: [
    { id: oneSeatId, guests: ["Luis"] },
    { id: twoSeatsId, guests: ["Marta"] },
  ],
  waiting: [
    { id: oneSeatId, position: 1, partySize: 1, guests: ["Luis"] },
    { id: twoSeatsId, position: 2, partySize: 1, guests: ["Marta"] },
    { id: couplesId, position: 3, partySize: 2, guests: ["Rosa", "Iván"] },
  ],
};

type RecordedCall = [string, AdminActionState, FormData];

function guestRow(overrides: Partial<EventGuestRow> = {}): EventGuestRow {
  return {
    kind: "RESERVATION",
    id: rowId,
    number: 4,
    position: null,
    guest1Name: "Ana López",
    guest1Instagram: "ana.lopez",
    guest2Name: null,
    guest2Instagram: null,
    partySize: 1,
    allergies: null,
    notes: null,
    status: "CONFIRMED",
    stage: "IN_REVIEW",
    releaseReason: null,
    refundStatus: null,
    source: "PUBLIC",
    submittedAt: new Date("2026-10-31T01:05:00Z"),
    onListAt: null,
    paidAt: null,
    cancelledAt: null,
    refundedAt: null,
    linkCode: null,
    contactId: null,
    contactUsername: null,
    lastMessage: null,
    ...overrides,
  };
}

function recordingAction() {
  return vi.fn(
    async (id: string, state: AdminActionState, formData: FormData): Promise<AdminActionState> => {
      void id;
      void state;
      void formData;
      return { ok: true, message: "Listo." };
    },
  );
}

function handlers() {
  return {
    accept: recordingAction(),
    verifyPayment: recordingAction(),
    reject: recordingAction(),
    cancel: recordingAction(),
    markRefunded: recordingAction(),
    move: recordingAction(),
    promote: recordingAction(),
    remove: recordingAction(),
    updateRequest: recordingAction(),
    updateEntry: recordingAction(),
    add: recordingAction(),
    retryMessage: recordingAction(),
    markMessageSent: recordingAction(),
    discardMessage: recordingAction(),
  } satisfies GuestActionHandlers;
}

function renderActions(
  row: EventGuestRow,
  options: { freeSeats?: number; queueSize?: number; preview?: PromotionPreview } = {},
) {
  const guestHandlers = handlers();
  render(
    <TooltipProvider>
      <GuestRowActions
        row={row}
        preview={options.preview ?? preview}
        freeSeats={options.freeSeats ?? 0}
        queueSize={options.queueSize ?? 3}
        handlers={guestHandlers}
      />
    </TooltipProvider>,
  );
  return guestHandlers;
}

async function openDialog(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await screen.findByRole("alertdialog");
}

function clickDialogConfirm(label: string) {
  const buttons = screen.getAllByRole("button", { name: label });
  fireEvent.click(buttons.at(-1)!);
}

async function confirmDialog(
  label: string,
  action: ReturnType<typeof recordingAction>,
): Promise<RecordedCall> {
  await openDialog(label);
  clickDialogConfirm(label);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  return action.mock.calls[0] as RecordedCall;
}

describe("GuestRowActions in review", () => {
  it("posts the one-seat replacements when rejecting a single guest", async () => {
    const guestHandlers = renderActions(guestRow());

    expect(screen.getByRole("button", { name: "Aceptar" })).toBeDefined();
    const [id, , formData] = await confirmDialog("Rechazar", guestHandlers.reject);

    expect(id).toBe(rowId);
    expect(formData.getAll("expectedPromotedEntryIds")).toEqual([oneSeatId]);
  });

  it("posts the two-seat replacements when the request is a couple", async () => {
    const guestHandlers = renderActions(
      guestRow({ partySize: 2, guest2Name: "Pedro", guest2Instagram: "pedro" }),
    );

    await openDialog("Rechazar");
    expect(screen.getByText(/van a quedar dos espacios vacíos/)).toBeDefined();
    expect(screen.getByText(/las solicitudes de Luis y de Marta/)).toBeDefined();
    clickDialogConfirm("Rechazar");
    await waitFor(() => expect(guestHandlers.reject).toHaveBeenCalledTimes(1));
    const [, , formData] = guestHandlers.reject.mock.calls[0] as RecordedCall;

    expect(formData.getAll("expectedPromotedEntryIds")).toEqual([oneSeatId, twoSeatsId]);
  });
});

describe("GuestRowActions on the list", () => {
  it("posts the optional payment reference when verifying the payment", async () => {
    const guestHandlers = renderActions(guestRow({ stage: "ON_LIST" }));

    await openDialog("Pago verificado");
    fireEvent.change(screen.getByLabelText("Referencia del pago"), {
      target: { value: "Transferencia 1234" },
    });
    clickDialogConfirm("Pago verificado");

    await waitFor(() => expect(guestHandlers.verifyPayment).toHaveBeenCalledTimes(1));
    const formData = (guestHandlers.verifyPayment.mock.calls[0] as RecordedCall)[2];
    expect(formData.get("paymentNote")).toBe("Transferencia 1234");
  });

  it("posts expectedStage ON_LIST when removing an unpaid guest", async () => {
    const guestHandlers = renderActions(guestRow({ stage: "ON_LIST" }));

    const [id, , formData] = await confirmDialog("Eliminar de la lista", guestHandlers.cancel);

    expect(id).toBe(rowId);
    expect(formData.get("expectedStage")).toBe("ON_LIST");
    expect(formData.getAll("expectedPromotedEntryIds")).toEqual([oneSeatId]);
  });

  it("posts expectedStage PAID when removing a confirmed guest", async () => {
    const guestHandlers = renderActions(guestRow({ stage: "PAID" }));

    expect(screen.queryByRole("button", { name: "Pago verificado" })).toBeNull();
    const [, , formData] = await confirmDialog("Eliminar de la lista", guestHandlers.cancel);

    expect(formData.get("expectedStage")).toBe("PAID");
  });
});

describe("GuestRowActions in the queue", () => {
  function waiting(position = 2) {
    return guestRow({ kind: "WAITLIST_ENTRY", position, status: "WAITING", stage: null });
  }

  it("shows move buttons and hides the promotion when the party does not fit", () => {
    renderActions(waiting(), { freeSeats: 0 });

    expect(screen.getByRole("button", { name: "Subir" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Bajar" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Pasar a la lista" })).toBeNull();
    expect(screen.getByRole("button", { name: "Quitar de la cola" })).toBeDefined();
  });

  it("offers the promotion when the party fits the free seats", () => {
    renderActions(waiting(), { freeSeats: 1 });

    expect(screen.getByRole("button", { name: "Pasar a la lista" })).toBeDefined();
  });

  it("asks for confirmation naming the guest before promoting", async () => {
    const guestHandlers = renderActions(waiting(), { freeSeats: 1 });

    await openDialog("Pasar a la lista");

    expect(
      screen.getByText(
        "Se pasará a Ana López de la cola a la lista y se le enviará el mensaje por Instagram.",
      ),
    ).toBeDefined();
    expect(guestHandlers.promote).not.toHaveBeenCalled();
  });

  it("names both guests of a couple in the promotion confirmation", async () => {
    renderActions(
      guestRow({
        kind: "WAITLIST_ENTRY",
        position: 2,
        status: "WAITING",
        stage: null,
        partySize: 2,
        guest2Name: "Luis Pérez",
        guest2Instagram: "luis.perez",
      }),
      { freeSeats: 2 },
    );

    await openDialog("Pasar a la lista");

    expect(screen.getByText(/Se pasará a Ana López y Luis Pérez de la cola/)).toBeDefined();
  });

  it("does not promote when the confirmation is cancelled", async () => {
    const guestHandlers = renderActions(waiting(), { freeSeats: 1 });

    await openDialog("Pasar a la lista");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(guestHandlers.promote).not.toHaveBeenCalled();
  });

  it("promotes once when the confirmation is accepted", async () => {
    const guestHandlers = renderActions(waiting(), { freeSeats: 1 });

    const [id] = await confirmDialog("Pasar a la lista", guestHandlers.promote);

    expect(id).toBe(rowId);
    expect(guestHandlers.promote).toHaveBeenCalledTimes(1);
  });

  it("disables Subir at the head and Bajar at the tail", () => {
    renderActions(waiting(1), { queueSize: 1 });

    expect(screen.getByRole("button", { name: "Subir" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Bajar" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("GuestRowActions after release", () => {
  function cancelled(refundStatus: EventGuestRow["refundStatus"]) {
    return guestRow({ status: "CANCELLED", stage: "PAID", refundStatus });
  }

  it("offers the refund only while it is pending", () => {
    renderActions(cancelled("PENDING"));

    expect(screen.getByRole("button", { name: "Reembolso realizado" })).toBeDefined();
  });

  it("offers no action once the refund is done", () => {
    renderActions(cancelled("REFUNDED"));

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("GuestRowActions choosing who takes the freed seat", () => {
  it("posts the automatic mode and no entry id by default", async () => {
    const guestHandlers = renderActions(guestRow());

    const [, , formData] = await confirmDialog("Rechazar", guestHandlers.reject);

    expect(formData.get("replacementMode")).toBe("auto");
    expect(formData.get("replacementEntryId")).toBeNull();
  });

  it("keeps the submit disabled until an entry of the cola is chosen", async () => {
    renderActions(guestRow());

    await openDialog("Rechazar");
    fireEvent.click(screen.getByRole("radio", { name: "Elegir de la cola" }));

    const submit = screen.getAllByRole("button", { name: "Rechazar" }).at(-1)!;
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Marta/ }));
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("posts the mode and the chosen entry id", async () => {
    const guestHandlers = renderActions(guestRow({ stage: "ON_LIST" }));

    await openDialog("Eliminar de la lista");
    fireEvent.click(screen.getByRole("radio", { name: "Elegir de la cola" }));
    fireEvent.click(screen.getByRole("radio", { name: /Marta/ }));
    clickDialogConfirm("Eliminar de la lista");
    await waitFor(() => expect(guestHandlers.cancel).toHaveBeenCalledTimes(1));
    const [, , formData] = guestHandlers.cancel.mock.calls[0] as RecordedCall;

    expect(formData.get("replacementMode")).toBe("chosen");
    expect(formData.getAll("replacementEntryId")).toEqual([twoSeatsId]);
    expect(formData.getAll("expectedPromotedEntryIds")).toEqual([]);
  });

  it("disables the entries whose party is larger than the freed seats", async () => {
    renderActions(guestRow());

    await openDialog("Rechazar");
    fireEvent.click(screen.getByRole("radio", { name: "Elegir de la cola" }));

    const couple = screen.getByRole("radio", { name: /Rosa y Iván/ });
    expect(couple.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("No cabe")).toBeDefined();
    expect(screen.getByRole("radio", { name: /Marta/ }).hasAttribute("disabled")).toBe(false);
  });

  it("lets a couple release the seats for a couple of the cola", async () => {
    renderActions(guestRow({ partySize: 2, guest2Name: "Pedro", guest2Instagram: "pedro" }));

    await openDialog("Rechazar");
    fireEvent.click(screen.getByRole("radio", { name: "Elegir de la cola" }));

    expect(screen.getByRole("radio", { name: /Rosa y Iván/ }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("2 personas")).toBeDefined();
    expect(screen.getByText("#3")).toBeDefined();
  });

  it("explains an empty cola and offers no choice", async () => {
    renderActions(guestRow(), {
      preview: { waitingCount: 0, oneSeat: [], twoSeats: [], waiting: [] },
    });

    await openDialog("Rechazar");

    expect(screen.getByText("No hay nadie en la cola.")).toBeDefined();
    expect(screen.queryByRole("radio")).toBeNull();
  });
});
