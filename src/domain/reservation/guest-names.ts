export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export function guestFirstNames(name1: string, name2: string | null): string {
  const guest1 = firstName(name1);
  return name2 === null ? guest1 : `${guest1} y ${firstName(name2)}`;
}
