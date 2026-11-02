import { formatDrinkPrice } from "@/domain/drink/drink-price";
import type { PaymentSettings } from "@/domain/payment/payment-settings";

export const PAYMENT_MESSAGE_VARIABLES = [
  "monto",
  "banco",
  "tipo_cuenta",
  "cuenta",
  "titular",
  "enlace_pago",
  "nota_pago",
  "pago",
] as const;

// Price and settings may be missing: the message still goes out, with those variables empty.
export interface PaymentMessageInput {
  priceCents: number | null;
  partySize: number;
  settings: PaymentSettings | null;
  note: string | null;
}

export type PaymentMessageValues = Record<(typeof PAYMENT_MESSAGE_VARIABLES)[number], string>;

// The composed block keeps templates written before the split variables working.
function composePaymentBlock(values: PaymentMessageValues): string {
  const labelled: [string, string][] = [
    ["Monto", values.monto],
    ["Banco", values.banco],
    ["Tipo de cuenta", values.tipo_cuenta],
    ["Cuenta", values.cuenta],
    ["Titular", values.titular],
    ["Enlace de pago", values.enlace_pago],
  ];
  const lines = labelled
    .filter(([, value]) => value !== "")
    .map(([label, value]) => `${label}: ${value}`);
  if (values.nota_pago !== "") lines.push(values.nota_pago);
  return lines.join("\n");
}

export function paymentMessageValues(input: PaymentMessageInput): PaymentMessageValues {
  const values: PaymentMessageValues = {
    monto: input.priceCents === null ? "" : formatDrinkPrice(input.priceCents * input.partySize),
    banco: input.settings?.bankName ?? "",
    tipo_cuenta: input.settings?.accountType ?? "",
    cuenta: input.settings?.accountNumber ?? "",
    titular: input.settings?.accountHolder ?? "",
    enlace_pago: input.settings?.paymentLink ?? "",
    nota_pago: input.note ?? "",
    pago: "",
  };
  return { ...values, pago: composePaymentBlock(values) };
}
