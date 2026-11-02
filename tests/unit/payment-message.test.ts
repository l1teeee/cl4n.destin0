import { describe, expect, it } from "vitest";

import { renderMessageTemplate, findUnknownVariables } from "@/domain/messaging/message-template";
import { TEMPLATE_VARIABLES } from "@/domain/messaging/message-types";
import { paymentMessageValues } from "@/domain/messaging/payment-message";
import { changedPaymentFields, type PaymentSettings } from "@/domain/payment/payment-settings";

const settings: PaymentSettings = {
  bankName: "Banco Agrícola",
  accountType: "Ahorro",
  accountNumber: "0123456789",
  accountHolder: "Ana Pérez",
  paymentLink: null,
};

describe("payment message values", () => {
  it("multiplies the price per person by the party size", () => {
    const solo = paymentMessageValues({ priceCents: 2500, partySize: 1, settings, note: null });
    const couple = paymentMessageValues({ priceCents: 2500, partySize: 2, settings, note: null });

    expect(solo.monto).toBe("$25.00");
    expect(couple.monto).toBe("$50.00");
  });

  it("exposes every bank field as its own variable", () => {
    const values = paymentMessageValues({
      priceCents: 1250,
      partySize: 1,
      settings: { ...settings, paymentLink: "https://pago.example.com/abc" },
      note: "Paga antes del jueves",
    });

    expect(values).toMatchObject({
      monto: "$12.50",
      banco: "Banco Agrícola",
      tipo_cuenta: "Ahorro",
      cuenta: "0123456789",
      titular: "Ana Pérez",
      enlace_pago: "https://pago.example.com/abc",
      nota_pago: "Paga antes del jueves",
    });
  });

  it("keeps {pago} as the composed block with the link and the note only when present", () => {
    const withoutExtras = paymentMessageValues({
      priceCents: 2500,
      partySize: 1,
      settings,
      note: null,
    });
    const withExtras = paymentMessageValues({
      priceCents: 2500,
      partySize: 1,
      settings: { ...settings, paymentLink: "https://pago.example.com/abc" },
      note: "Paga antes del jueves",
    });

    expect(withoutExtras.pago).toBe(
      "Monto: $25.00\nBanco: Banco Agrícola\nTipo de cuenta: Ahorro\nCuenta: 0123456789\nTitular: Ana Pérez",
    );
    expect(withExtras.pago).toBe(
      [
        "Monto: $25.00",
        "Banco: Banco Agrícola",
        "Tipo de cuenta: Ahorro",
        "Cuenta: 0123456789",
        "Titular: Ana Pérez",
        "Enlace de pago: https://pago.example.com/abc",
        "Paga antes del jueves",
      ].join("\n"),
    );
  });

  it("renders the separate variables and the composed block in a template", () => {
    const values = paymentMessageValues({ priceCents: 2500, partySize: 2, settings, note: null });

    expect(
      renderMessageTemplate(
        "Transfiere {monto} a {titular} ({banco}, {tipo_cuenta} {cuenta}).",
        values,
      ),
    ).toBe("Transfiere $50.00 a Ana Pérez (Banco Agrícola, Ahorro 0123456789).");
    expect(renderMessageTemplate("{pago}", values)).toBe(values.pago);
  });

  it("leaves empty optional variables out of the rendered message", () => {
    const values = paymentMessageValues({ priceCents: 2500, partySize: 1, settings, note: null });

    expect(
      renderMessageTemplate("Cuenta {cuenta}\n{enlace_pago}\n{nota_pago}\n\nGracias", values),
    ).toBe("Cuenta 0123456789\n\nGracias");
  });

  it("renders the data it has and leaves the rest empty when the price is missing", () => {
    const values = paymentMessageValues({ priceCents: null, partySize: 1, settings, note: null });

    expect(values.monto).toBe("");
    expect(values.banco).toBe("Banco Agrícola");
    expect(values.pago).toBe(
      "Banco: Banco Agrícola\nTipo de cuenta: Ahorro\nCuenta: 0123456789\nTitular: Ana Pérez",
    );
  });

  it("renders only the amount and the note when the payment settings are missing", () => {
    const values = paymentMessageValues({
      priceCents: 2500,
      partySize: 2,
      settings: null,
      note: "Paga antes del jueves",
    });

    expect(values).toMatchObject({
      monto: "$50.00",
      banco: "",
      tipo_cuenta: "",
      cuenta: "",
      titular: "",
      enlace_pago: "",
      pago: "Monto: $50.00\nPaga antes del jueves",
    });
  });

  it("renders every variable empty when nothing is configured", () => {
    const values = paymentMessageValues({
      priceCents: null,
      partySize: 1,
      settings: null,
      note: null,
    });

    expect(Object.values(values).every((value) => value === "")).toBe(true);
  });

  it("allows every payment variable in the ON_LIST template and nothing else new", () => {
    expect(TEMPLATE_VARIABLES.ON_LIST).toEqual([
      "nombre",
      "nombres",
      "fecha",
      "monto",
      "banco",
      "tipo_cuenta",
      "cuenta",
      "titular",
      "enlace_pago",
      "nota_pago",
      "pago",
    ]);
    expect(findUnknownVariables("ON_LIST", "{monto} {enlace_pago} {pago} {posicion}")).toEqual([
      "posicion",
    ]);
    expect(TEMPLATE_VARIABLES.PAID).not.toContain("monto");
  });
});

describe("changedPaymentFields", () => {
  it("lists every field when nothing was saved before", () => {
    expect(changedPaymentFields(null, settings)).toEqual([
      "bankName",
      "accountType",
      "accountNumber",
      "accountHolder",
      "paymentLink",
    ]);
  });

  it("lists only the fields that changed", () => {
    expect(changedPaymentFields(settings, { ...settings, accountNumber: "999" })).toEqual([
      "accountNumber",
    ]);
    expect(changedPaymentFields(settings, settings)).toEqual([]);
  });
});
