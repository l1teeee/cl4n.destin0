import { describe, expect, it } from "vitest";

import { groupTabMessageValues, type GroupTabMessageInput } from "@/domain/economy/tab-message";
import type { PaymentSettings } from "@/domain/payment/payment-settings";

const settings: PaymentSettings = {
  bankName: "Banco Agrícola",
  accountType: "Ahorro",
  accountNumber: "0123456789",
  accountHolder: "Clandestino",
  paymentLink: "https://pago.example.com/cuenta",
};

const input: GroupTabMessageInput = {
  titularFullName: "  María   López Pérez ",
  eventDate: "22 de noviembre de 2030",
  people: [
    {
      fullName: "María López",
      lines: [
        { itemName: "Café", quantity: 2, totalCents: 650 },
        { itemName: "Postre", quantity: 1, totalCents: 425 },
      ],
      totalCents: 1075,
    },
  ],
  groupSize: 1,
  settings,
};

describe("groupTabMessageValues", () => {
  it("formats each line total, the tab total and the guest's first name", () => {
    expect(groupTabMessageValues(input)).toEqual({
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
    const values = groupTabMessageValues({
      ...input,
      settings: { ...settings, bankName: "", accountNumber: "", paymentLink: null },
    });

    expect(values.datos_pago).toBe("Tipo de cuenta: Ahorro\nTitular: Clandestino");
    expect(values.banco).toBe("");
    expect(values.cuenta).toBe("");
    expect(values.enlace_pago).toBe("");
  });

  it("leaves all payment variables empty when settings are missing", () => {
    expect(groupTabMessageValues({ ...input, settings: null })).toMatchObject({
      banco: "",
      tipo_cuenta: "",
      cuenta: "",
      titular: "",
      enlace_pago: "",
      datos_pago: "",
    });
  });

  it("formats couple subtotals and the group total", () => {
    const values = groupTabMessageValues({
      ...input,
      groupSize: 2,
      people: [
        ...input.people,
        {
          fullName: "Luis Pérez",
          lines: [{ itemName: "Té", quantity: 1, totalCents: 200 }],
          totalCents: 200,
        },
      ],
    });
    expect(values.consumos).toBe(
      "María\n2 × Café: $6.50\n1 × Postre: $4.25\nSubtotal: $10.75\n\nLuis\n1 × Té: $2.00\nSubtotal: $2.00",
    );
    expect(values.total).toBe("$12.75");
  });

  it("adds the group heading and per-person subtotals from four people", () => {
    const person = (fullName: string) => ({
      fullName,
      lines: [{ itemName: "Té", quantity: 1, totalCents: 200 }],
      totalCents: 200,
    });
    const values = groupTabMessageValues({
      ...input,
      groupSize: 4,
      people: [
        person("María López"),
        person("Luis Pérez"),
        person("Ana Gómez"),
        person("Eva Ruiz"),
      ],
    });
    expect(values.consumos).toBe(
      "Cuenta de tu grupo de 4:\n\nMaría\n1 × Té: $2.00\nSubtotal: $2.00\n\nLuis\n1 × Té: $2.00\nSubtotal: $2.00\n\nAna\n1 × Té: $2.00\nSubtotal: $2.00\n\nEva\n1 × Té: $2.00\nSubtotal: $2.00",
    );
    expect(values.total).toBe("$8.00");
  });

  it("keeps the solo and pair wording free of the group heading", () => {
    expect(groupTabMessageValues(input).consumos).not.toContain("grupo");
    expect(groupTabMessageValues({ ...input, groupSize: 2 }).consumos).not.toContain("grupo");
  });
});
