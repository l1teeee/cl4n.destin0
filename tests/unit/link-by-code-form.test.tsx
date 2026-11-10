// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { ConversationControls } from "@/ui/admin/messages/conversation-controls";
import { LinkByCodeForm } from "@/ui/admin/messages/link-by-code-form";

afterEach(cleanup);

function createAction(result: AdminActionState) {
  return vi.fn(async (_contactId: string, _state: AdminActionState, _formData: FormData) => {
    void _contactId;
    void _state;
    void _formData;
    return result;
  });
}

describe("LinkByCodeForm", () => {
  it("submits the contact id and code to the supplied action and closes on success", async () => {
    const action = createAction({ ok: true, message: "Vinculada." });
    const onClose = vi.fn();
    render(<LinkByCodeForm contactId="contact-1" action={action} open onClose={onClose} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Código de solicitud" }), {
      target: { value: "AB23CD" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Vincular" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]![0]).toBe("contact-1");
    expect((action.mock.calls[0]![2] as FormData).get("code")).toBe("AB23CD");
    expect(await screen.findByText("Vinculada.")).toBeDefined();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open and shows the error when linking fails", async () => {
    const action = createAction({ ok: false, message: "El código no existe." });
    const onClose = vi.fn();
    render(<LinkByCodeForm contactId="contact-1" action={action} open onClose={onClose} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Código de solicitud" }), {
      target: { value: "ZZZZZZ" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Vincular" }).closest("form")!);

    expect(await screen.findByText("El código no existe.")).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("focuses the code input when it opens", () => {
    const action = createAction({ ok: true, message: "" });
    const view = render(
      <LinkByCodeForm contactId="contact-1" action={action} open={false} onClose={vi.fn()} />,
    );
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));

    view.rerender(<LinkByCodeForm contactId="contact-1" action={action} open onClose={vi.fn()} />);

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Código de solicitud" }),
    );
  });

  it("closes with Escape and with the cancel button", () => {
    const onClose = vi.fn();
    render(
      <LinkByCodeForm
        contactId="contact-1"
        action={createAction({ ok: true, message: "" })}
        open
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("ConversationControls", () => {
  it("offers to delete a conversation without linked requests", () => {
    render(
      <ConversationControls
        contactId="contact-1"
        linkedRequests={[]}
        unlinkAction={createAction({ ok: true, message: "" })}
        deleteAction={createAction({ ok: true, message: "" })}
      />,
    );

    expect(screen.getByRole("button", { name: "Eliminar conversación" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Desvincular" })).toBeNull();
  });

  it("offers to unlink each linked request", () => {
    render(
      <ConversationControls
        contactId="contact-1"
        linkedRequests={[
          {
            id: "reservation-1",
            type: "RESERVATION",
            eventId: "event-1",
            eventName: "Cena",
            eventStartsAt: new Date("2026-11-03T20:30:00.000Z"),
            guests: ["Ana"],
            instagramHandles: [],
            status: "CONFIRMED",
            stage: null,
            role: "TITULAR",
          },
        ]}
        unlinkAction={createAction({ ok: true, message: "" })}
        deleteAction={createAction({ ok: true, message: "" })}
      />,
    );

    expect(screen.getByRole("button", { name: "Desvincular" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Eliminar conversación" })).toBeNull();
  });
});
