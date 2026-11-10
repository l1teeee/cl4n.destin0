import type { ColumnMapping, ImportField } from "@/contracts/guest-import";

export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((header) =>
    header
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim(),
  );
  const companion = (header: string) =>
    ["acompanante", "pareja", "invitado 2", "persona 2", "segunda persona"].some((word) =>
      header.includes(word),
    );
  const instagram = (header: string) =>
    ["instagram", "usuario", "@"].some((word) => header.includes(word));
  const rules: [ImportField, (header: string) => boolean][] = [
    ["timestamp", (header) => header.includes("marca temporal") || header.includes("timestamp")],
    ["guest2Instagram", (header) => companion(header) && instagram(header)],
    ["guest2Name", (header) => companion(header) && header.includes("nombre")],
    ["guest1Instagram", instagram],
    ["guest1Name", (header) => header.includes("nombre")],
    ["allergies", (header) => header.includes("alergi")],
    ["notes", (header) => /nota|comentario|observacion/.test(header)],
  ];
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const [field, matches] of rules) {
    const index = normalized.findIndex((header, column) => !used.has(column) && matches(header));
    if (index !== -1) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}
