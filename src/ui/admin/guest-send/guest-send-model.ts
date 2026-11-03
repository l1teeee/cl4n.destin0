export type GuestSendStatus = "NOT_SENT" | "SENT" | "PENDING" | "FAILED";
export type GuestRole = "TITULAR" | "ACOMPANANTE";

export interface GuestSendPerson {
  key: string;
  name: string;
  instagram: string | null;
  role: GuestRole;
  status?: GuestSendStatus; // undefined: the item is not tracked and can always be sent
  detail?: string; // e.g. a tab total
}

export interface GuestSendGroup {
  key: string;
  label: string; // e.g. "#001"
  people: readonly GuestSendPerson[]; // titular first
  detail?: string; // e.g. the group bill total
}

// PERSON: each person is chosen and receives it (clues, location). GROUP: each group is chosen and its titular receives it (tabs).
export type GuestSendTarget = "PERSON" | "GROUP";

export const GROUP_ACCENT_CLASSES = [
  "border-l-[#c9a96e]",
  "border-l-[#7fa7c9]",
  "border-l-[#9cc98f]",
  "border-l-[#c98f9c]",
  "border-l-[#b49cc9]",
  "border-l-[#c9c18f]",
] as const;

export function groupAccentClass(index: number): string {
  return GROUP_ACCENT_CLASSES[index % GROUP_ACCENT_CLASSES.length] ?? GROUP_ACCENT_CLASSES[0];
}

export function isSendable(person: GuestSendPerson | undefined): boolean {
  return person !== undefined && (person.status === undefined || person.status === "NOT_SENT");
}

export function sendableKeys(groups: readonly GuestSendGroup[], target: GuestSendTarget): string[] {
  if (target === "GROUP") {
    return groups.filter((group) => isSendable(group.people[0])).map((group) => group.key);
  }
  return groups.flatMap((group) => group.people.filter(isSendable).map((person) => person.key));
}

export function statusLabel(status: GuestSendStatus): string {
  switch (status) {
    case "NOT_SENT":
      return "No enviada";
    case "SENT":
      return "Enviada";
    case "PENDING":
      return "Pendiente";
    case "FAILED":
      return "Falló";
  }
}
