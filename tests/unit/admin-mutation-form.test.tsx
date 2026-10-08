// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { MutationForm } from "@/ui/admin/mutation-form";

afterEach(cleanup);

function result(ok: boolean, message: string): AdminActionState {
  return { ok, message };
}

describe("MutationForm", () => {
  it("submits inline and renders the success alert", async () => {
    const action = vi.fn().mockResolvedValue(result(true, "Guardado."));
    render(<MutationForm action={action} label="Guardar" />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("status")).textContent).toContain("Guardado.");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("opens a confirmation dialog and cancel closes it", async () => {
    render(
      <MutationForm
        action={vi.fn()}
        label="Eliminar"
        confirmation="Esta acción no se puede revertir."
        danger
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(screen.getByText("Esta acción no se puede revertir.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("runs the confirmed action and closes on success", async () => {
    const action = vi.fn().mockResolvedValue(result(true, "Eliminado."));
    render(
      <MutationForm action={action} label="Eliminar" confirmation="Confirma para continuar." />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect((await screen.findByRole("status")).textContent).toContain("Eliminado.");
    expect(action).toHaveBeenCalledTimes(1);
    expect(dialog).toBeDefined();
  });

  it("keeps the dialog open and renders the error alert on failure", async () => {
    const action = vi.fn().mockResolvedValue(result(false, "No se pudo eliminar."));
    render(
      <MutationForm action={action} label="Eliminar" confirmation="Confirma para continuar." />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect((await screen.findByRole("status")).textContent).toContain("No se pudo eliminar.");
    expect(screen.getByRole("alertdialog")).toBeDefined();
  });

  it("shows a pending spinner while the action is unresolved", async () => {
    let resolveAction: ((value: AdminActionState) => void) | undefined;
    const action = vi.fn(
      () =>
        new Promise<AdminActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const { container } = render(<MutationForm action={action} label="Guardar" />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(
      (await screen.findByRole("button", { name: "Procesando..." })).hasAttribute("disabled"),
    ).toBe(true);
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    resolveAction?.(result(true, "Guardado."));
    expect((await screen.findByRole("status")).textContent).toContain("Guardado.");
  });
});
