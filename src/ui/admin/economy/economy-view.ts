import type { ConsumptionLine, EconomyGuest } from "@/application/economy/economy-repository";
import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
import { formatReservationNumber } from "@/ui/admin/view-model";

export type TabFilter = "ALL" | "PENDING" | "PAID";

export const tabFilters: readonly { id: TabFilter; label: string }[] = [
  { id: "ALL", label: "Todos" },
  { id: "PENDING", label: "Pendientes" },
  { id: "PAID", label: "Pagados" },
];

type GuestTabKey = Pick<EconomyGuest, "reservationId" | "slot">;

export function guestKey(guest: GuestTabKey): string {
  return `${guest.reservationId}:${guest.slot}`;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^@/, "");
}

export function filterGuests(
  guests: readonly EconomyGuest[],
  filter: TabFilter,
  query: string,
): EconomyGuest[] {
  const search = normalizeSearch(query);

  return guests.filter((guest) => {
    if (filter === "PENDING" && guest.settled) return false;
    if (filter === "PAID" && !guest.settled) return false;
    if (search === "") return true;
    return (
      normalizeSearch(guest.fullName).includes(search) ||
      normalizeSearch(guest.instagram ?? "").includes(search)
    );
  });
}

export function economySummary(guests: readonly EconomyGuest[]): string {
  const settled = guests.filter((guest) => guest.settled).length;
  const guestWord = guests.length === 1 ? "invitado" : "invitados";
  const settledWord = settled === 1 ? "pagado" : "pagados";
  return `${guests.length} ${guestWord} · ${settled} ${settledWord}`;
}

export function guestHeading(guest: EconomyGuest): string {
  const parts = [formatReservationNumber(guest.reservationNumber), guest.fullName];
  if (guest.instagram) parts.push(`@${guest.instagram}`);
  return parts.join(" · ");
}

export function guestRoleLabel(slot: number): string {
  return slot === 1 ? "Titular" : `Acompañante ${slot - 1}`;
}

export function stageLabel(stage: EconomyGuest["stage"]): string {
  return stage === "PAID" ? "Confirmado" : "En la lista";
}

export function lineQuantityLabel(line: ConsumptionLine): string {
  return `${line.quantity} × ${formatDrinkPrice(line.unitPriceCents)}`;
}

export function lineTimeLabel(line: ConsumptionLine): string {
  return formatUtcForElSalvador(line.createdAt, "HH:mm");
}

export function itemButtonLabel(item: { name: string; priceCents: number }): string {
  return `${item.name} · ${formatDrinkPrice(item.priceCents)}`;
}
