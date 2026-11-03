import { describe, expect, it } from "vitest";

import { tabMessageValues, type TabMessageInput } from "@/domain/economy/tab-message";
import type { PaymentSettings } from "@/domain/payment/payment-settings";

const settings: PaymentSettings = {
  bankName: "Banco Agrícola",
  accountType: "Ahorro",
  accountNumber: "0123456789",
  accountHolder: "Clandestino",
  paymentLink: "https://pago.example.com/cuenta",
};

const input: TabMessageInput = {
  guestFullName: "  María   López Pérez ",
  eventDate: "22 de noviembre de 2030",
  lines: [
    { itemName: "Café", quantity: 2, totalCents: 650 },
    { itemName: "Postre", quantity: 1, totalCents: 425 },
  ],
  totalCents: 1075,
  settings,
};

describe("tabMessageValues", () => {
  it("formats each line total, the tab total and the guest's first name", () => {
    expect(tabMessageValues(input)).toEqual({
      nombre: "María",
      fecha: "22 de noviembre de 2030",
      consumos: "2 × Café: $6.50\n1 × Postre: $4.25",
      total: "$10.75",
      banco: "Banco Agrícola",
      tipo_cuenta: "Ahorro",
      cuenta: "0123456789",
      titular: "Clandestino",
      enlace_pago: "https://pago.example.com/cuenta",
      datos_pago: [
        "Banco: Banco Agrícola",
        "Tipo de cuenta: Ahorro",
        "Cuenta: 0123456789",
        "Titular: Clandestino",
        "Enlace de pago: https://pago.example.com/cuenta",
      ].join("\n"),
    });
  });

  it("omits empty payment account lines without adding an amount or note", () => {
    const values = tabMessageValues({
      ...input,
      settings: { ...settings, bankName: "", accountNumber: "", paymentLink: null },
    });

    expect(values.datos_pago).toBe("Tipo de cuenta: Ahorro\nTitular: Clandestino");
    expect(values.banco).toBe("");
    expect(values.cuenta).toBe("");
    expect(values.enlace_pago).toBe("");
  });

  it("leaves all payment variables empty when settings are missing", () => {
    expect(tabMessageValues({ ...input, settings: null })).toMatchObject({
      banco: "",
      tipo_cuenta: "",
      cuenta: "",
      titular: "",
      enlace_pago: "",
      datos_pago: "",
    });
  });
});
