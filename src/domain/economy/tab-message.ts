import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { paymentAccountBlock } from "@/domain/messaging/payment-message";
import type { PaymentSettings } from "@/domain/payment/payment-settings";
import { firstName } from "@/domain/reservation/guest-names";

export interface TabMessageLine {
  itemName: string;
  quantity: number;
  totalCents: number;
}

export interface TabMessageInput {
  guestFullName: string;
  eventDate: string;
  lines: readonly TabMessageLine[];
  totalCents: number;
  settings: PaymentSettings | null;
}

export function tabMessageValues(input: TabMessageInput): Record<string, string> {
  return {
    nombre: firstName(input.guestFullName),
    fecha: input.eventDate,
    consumos: input.lines
      .map((line) => `${line.quantity} × ${line.itemName}: ${formatDrinkPrice(line.totalCents)}`)
      .join("\n"),
    total: formatDrinkPrice(input.totalCents),
    banco: input.settings?.bankName ?? "",
    tipo_cuenta: input.settings?.accountType ?? "",
    cuenta: input.settings?.accountNumber ?? "",
    titular: input.settings?.accountHolder ?? "",
    enlace_pago: input.settings?.paymentLink ?? "",
    datos_pago: paymentAccountBlock(input.settings),
  };
}
