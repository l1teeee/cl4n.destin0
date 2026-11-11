import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { paymentAccountBlock } from "@/domain/messaging/payment-message";
import type { PaymentSettings } from "@/domain/payment/payment-settings";
import { firstName } from "@/domain/reservation/guest-names";

export interface TabMessageLine {
  itemName: string;
  quantity: number;
  totalCents: number;
}

export interface GroupTabMessageInput {
  titularFullName: string;
  eventDate: string;
  people: Array<{ fullName: string; lines: readonly TabMessageLine[]; totalCents: number }>;
  groupSize: number;
  settings: PaymentSettings | null;
}

const GROUP_WORDING_MIN_SIZE = 3;

export function groupTabMessageValues(input: GroupTabMessageInput): Record<string, string> {
  const consumos = input.people.map((person) => {
    const lines = person.lines
      .map((line) => `${line.quantity} × ${line.itemName}: ${formatDrinkPrice(line.totalCents)}`)
      .join("\n");
    return input.groupSize > 1
      ? `${firstName(person.fullName)}\n${lines}\nSubtotal: ${formatDrinkPrice(person.totalCents)}`
      : lines;
  });
  const groupHeading =
    input.groupSize >= GROUP_WORDING_MIN_SIZE
      ? `Cuenta de tu grupo de ${input.groupSize}:\n\n`
      : "";
  return {
    nombre: firstName(input.titularFullName),
    fecha: input.eventDate,
    consumos: groupHeading + consumos.join("\n\n"),
    total: formatDrinkPrice(input.people.reduce((total, person) => total + person.totalCents, 0)),
    banco: input.settings?.bankName ?? "",
    tipo_cuenta: input.settings?.accountType ?? "",
    cuenta: input.settings?.accountNumber ?? "",
    titular: input.settings?.accountHolder ?? "",
    enlace_pago: input.settings?.paymentLink ?? "",
    datos_pago: paymentAccountBlock(input.settings),
  };
}
