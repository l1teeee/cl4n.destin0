// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { PaymentSettingsForm } from "@/ui/admin/payment-settings-form";

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

type PaymentAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

const settings = {
  bankName: "Banco Agrícola",
  accountType: "Corriente",
  accountNumber: "0123456789",
  accountHolder: "Ana Pérez",
  paymentLink: "https://pago.example.com/abc",
} as const;

describe("PaymentSettingsForm", () => {
  it("starts empty with Ahorro selected when nothing was saved", () => {
    const { container } = render(<PaymentSettingsForm action={vi.fn()} settings={null} />);

    expect(screen.getByLabelText("Banco")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Número de cuenta")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Titular")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Enlace o código de pago (opcional)")).toHaveProperty("value", "");
    expect(screen.getByText("El enlace o código que te da la app del banco")).toBeDefined();
    expect(container.querySelector("select[name='accountType']")).toHaveProperty("value", "Ahorro");
  });

  it("shows the saved values and submits them", async () => {
    const action = vi.fn<PaymentAction>(async (state, formData) => {
      void state;
      void formData;
      return { ok: true, message: "Datos de pago guardados." };
    });
    render(<PaymentSettingsForm action={action} settings={settings} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Datos de pago guardados.")).toBeDefined();
    const submitted = action.mock.calls[0]![1];
    expect(Object.fromEntries(submitted.entries())).toEqual({
      bankName: "Banco Agrícola",
      accountType: "Corriente",
      accountNumber: "0123456789",
      accountHolder: "Ana Pérez",
      paymentLink: "https://pago.example.com/abc",
    });
  });

  it("shows field errors and focuses the first invalid field", async () => {
    const action = vi.fn(async (): Promise<AdminActionState> => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { bankName: "El banco es obligatorio." },
    }));
    render(<PaymentSettingsForm action={action} settings={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("El banco es obligatorio.")).toBeDefined();
    const bank = screen.getByLabelText("Banco");
    expect(bank.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(bank));
  });
});
