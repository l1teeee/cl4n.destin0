// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { ExtraForm } from "@/ui/admin/extra-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  router.push.mockClear();
  router.refresh.mockClear();
});

describe("ExtraForm", () => {
  it("shows the saved values when editing", () => {
    render(
      <ExtraForm
        mode="edit"
        extra={{ name: "Pan", priceCents: 350, sortOrder: 2, isActive: false }}
        action={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/^Nombre/) as HTMLInputElement).value).toBe("Pan");
    expect((screen.getByLabelText(/^Precio/) as HTMLInputElement).value).toBe("3.50");
    expect((screen.getByLabelText(/^Orden/) as HTMLInputElement).value).toBe("2");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDefined();
  });

  it("submits the typed values and goes back to the list on success", async () => {
    const action = vi
      .fn<(state: AdminActionState, formData: FormData) => Promise<AdminActionState>>()
      .mockResolvedValue({ ok: true, message: "Extra creado." });
    render(<ExtraForm mode="create" action={action} />);

    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Cucharas" } });
    fireEvent.change(screen.getByLabelText(/^Precio/), { target: { value: "1.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear extra" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/extras"));
    const sent = action.mock.calls[0]![1];
    expect(sent.get("name")).toBe("Cucharas");
    expect(sent.get("price")).toBe("1.25");
  });

  it("keeps what was typed and shows the field errors when the save is rejected", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { price: "Escribe el precio con números, por ejemplo 4.50." },
    });
    render(<ExtraForm mode="create" action={action} />);

    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: "Cucharas" } });
    fireEvent.change(screen.getByLabelText(/^Precio/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear extra" }));

    expect(
      await screen.findByText("Escribe el precio con números, por ejemplo 4.50."),
    ).toBeDefined();
    expect((screen.getByLabelText(/^Nombre/) as HTMLInputElement).value).toBe("Cucharas");
    expect(router.push).not.toHaveBeenCalled();
  });
});
