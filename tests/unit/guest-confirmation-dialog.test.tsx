// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { ExpectedReplacementInputs } from "@/ui/admin/guests/expected-replacement-inputs";
import { rejectConfirmation } from "@/ui/admin/guests/guest-copy";
import { GuestMessageToggle } from "@/ui/admin/guests/guest-message-toggle";
import { MutationForm } from "@/ui/admin/mutation-form";

type Action = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

afterEach(cleanup);

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const preview = "Hola Ana.\nPor ahora no tenemos lugar para ti.";

function renderRejectDialog(action: Action) {
  return render(
    <MutationForm
      action={action}
      label="Rechazar"
      danger
      confirmation={rejectConfirmation({
        guests: ["Ana López"],
        replacements: ["Carla", "Pedro"],
        waitingCount: 2,
      })}
    >
      <ExpectedReplacementInputs entryIds={[firstId, secondId]} />
      <GuestMessageToggle preview={preview} />
    </MutationForm>,
  );
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
  return await screen.findByRole("alertdialog");
}

function confirm(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Rechazar" }));
}

function postedForm(action: ReturnType<typeof vi.fn<Action>>, call: number): FormData {
  return action.mock.calls[call]![1];
}

describe("guest controls inside a MutationForm confirmation", () => {
  it("shows the confirmation copy, the message toggle and its preview", async () => {
    renderRejectDialog(vi.fn<Action>());

    const dialog = await openDialog();

    expect(
      within(dialog).getByText(
        "Al rechazar a Ana López va a quedar un espacio vacío. Se van a agregar desde la cola las solicitudes de Carla y de Pedro. ¿Estás seguro?",
      ),
    ).toBeDefined();
    const checkbox = within(dialog).getByRole("checkbox", {
      name: "Enviar mensaje por Instagram",
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(within(dialog).getByText("Ver mensaje")).toBeDefined();
  });

  it("posts the message choice and the expected queue entries in order", async () => {
    const action = vi.fn<Action>(async () => ({ ok: true, message: "Listo." }));
    renderRejectDialog(action);
    const dialog = await openDialog();

    confirm(dialog);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = postedForm(action, 0);
    expect(formData.get("sendMessage")).toBe("on");
    expect(formData.getAll("expectedPromotedEntryIds")).toEqual([firstId, secondId]);
  });

  it("does not post the message choice when the admin turns it off", async () => {
    const action = vi.fn<Action>(async () => ({ ok: true, message: "Listo." }));
    renderRejectDialog(action);
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    confirm(dialog);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(postedForm(action, 0).has("sendMessage")).toBe(false);
    expect(postedForm(action, 0).getAll("expectedPromotedEntryIds")).toEqual([firstId, secondId]);
  });

  it("keeps the checkbox equal to what the next submit posts after a failed action", async () => {
    const action = vi.fn<Action>(async () => ({ ok: false, message: "La cola cambió." }));
    renderRejectDialog(action);
    const dialog = await openDialog();
    const checkbox = within(dialog).getByRole("checkbox") as HTMLInputElement;

    fireEvent.click(checkbox);
    confirm(dialog);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await within(dialog).findByText("La cola cambió.");
    const shownAfterFailure = checkbox.checked;
    confirm(dialog);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(postedForm(action, 1).has("sendMessage")).toBe(shownAfterFailure);
    expect(postedForm(action, 1).getAll("expectedPromotedEntryIds")).toEqual([firstId, secondId]);
  });
});
