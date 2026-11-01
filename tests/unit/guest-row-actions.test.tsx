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

const preview: PromotionPreview = {
  oneSeat: [{ id: oneSeatId, guests: ["Luis"] }],
  twoSeats: [
    { id: oneSeatId, guests: ["Luis"] },
    { id: twoSeatsId, guests: ["Marta"] },
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
  options: { freeSeats?: number; queueSize?: number } = {},
) {
  const guestHandlers = handlers();
  render(
    <TooltipProvider>
      <GuestRowActions
        row={row}
        preview={preview}
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

    const [, , formData] = await confirmDialog("Rechazar", guestHandlers.reject);

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
