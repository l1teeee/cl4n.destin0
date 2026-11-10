// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { formatDrinkPrice } from "@/domain/drink/drink-price";
import type { PaymentSettings } from "@/domain/payment/payment-settings";
import { PaymentPreview } from "@/ui/admin/payment-preview";

afterEach(cleanup);

const settings: PaymentSettings = {
  bankName: "Banco Agrícola",
  accountType: "Ahorro",
  accountNumber: "123456",
  accountHolder: "Clan SA",
  paymentLink: null,
};

describe("PaymentPreview", () => {
  it("shows the price, bank details, and note", () => {
    render(
      <PaymentPreview settings={settings} priceCents={3000} note="Paga antes del miércoles" />,
    );

    const text = screen.getByText(/Banco: Banco Agrícola/).textContent;
    expect(text).toContain(`Monto: ${formatDrinkPrice(3000)}`);
    expect(text).toContain("Banco: Banco Agrícola");
    expect(text).toContain("Cuenta: 123456");
    expect(text).toContain("Titular: Clan SA");
    expect(text).toContain("Paga antes del miércoles");
  });

  it("shows the missing bank details message and note", () => {
    render(<PaymentPreview settings={null} priceCents={null} note="Paga antes del miércoles" />);

    expect(screen.getByText("Aún no hay datos bancarios guardados en Mi cuenta.")).toBeDefined();
    expect(screen.getByText("Paga antes del miércoles")).toBeDefined();
  });

  it("omits the amount when the price and note are empty", () => {
    render(<PaymentPreview settings={settings} priceCents={null} note="" />);

    expect(screen.getByText(/Banco: Banco Agrícola/).textContent).not.toContain("Monto:");
  });
});
