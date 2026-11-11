import { normalizeInstagram } from "./contact-normalization";
import { firstName } from "./guest-names";

export const MAX_PARTY_SIZE = 100;

export interface RequestGuest {
  slot: number;
  name: string;
  instagram: string;
}

export function guestFirstNames(names: readonly string[]): string {
  const namesToJoin = names.map(firstName);
  if (namesToJoin.length < 2) return namesToJoin.join("");
  return `${namesToJoin.slice(0, -1).join(", ")} y ${namesToJoin[namesToJoin.length - 1]}`;
}

export function hasDuplicateHandles(handles: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const handle of handles) {
    const normalized = normalizeInstagram(handle);
    if (!normalized.ok) continue;
    if (seen.has(normalized.value)) return true;
    seen.add(normalized.value);
  }
  return false;
}
