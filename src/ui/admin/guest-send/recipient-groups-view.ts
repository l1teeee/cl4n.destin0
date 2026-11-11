import type { RecipientGroup, RecipientPerson } from "@/application/messaging/recipient-groups";
import { formatReservationNumber } from "@/ui/admin/view-model";

import type { GuestSendGroup, GuestSendPerson } from "./guest-send-model";

const NOT_LINKED_DETAIL = "Aún no nos escribe: saldrá cuando escriba";

function toGuestSendPerson(
  reservationId: string,
  person: RecipientPerson,
  itemId: string,
): GuestSendPerson {
  const status = person.statusByItem[itemId] ?? "NOT_SENT";
  const waitingForGuest = !person.linked && (status === "NOT_SENT" || status === "PENDING");
  return {
    key: `${reservationId}:${person.slot}`,
    slot: person.slot,
    name: person.name,
    instagram: person.instagram,
    role: person.slot === 1 ? "TITULAR" : "ACOMPANANTE",
    status,
    ...(waitingForGuest ? { detail: NOT_LINKED_DETAIL } : {}),
  };
}

export function toGuestSendGroups(
  groups: readonly RecipientGroup[],
  itemId: string,
): GuestSendGroup[] {
  return groups.map((group) => ({
    key: group.reservationId,
    label: formatReservationNumber(group.reservationNumber),
    people: group.people.map((person) => toGuestSendPerson(group.reservationId, person, itemId)),
  }));
}
