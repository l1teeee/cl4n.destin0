import {
  MAX_IMPORT_COMPANIONS,
  type ColumnMapping,
  type CompanionMapping,
  type ImportField,
} from "@/contracts/guest-import";

const COMPANION_WORDS = ["acompanante", "pareja", "invitado", "persona"];
// In these words the titular is number 1, so "persona 2" is the first companion.
const TITULAR_COUNTED_WORDS = ["invitado", "persona"];

function isInstagramHeader(header: string): boolean {
  return ["instagram", "usuario", "@"].some((word) => header.includes(word));
}

function isCompanionHeader(header: string): boolean {
  return COMPANION_WORDS.some((word) => header.includes(word));
}

function companionNumber(header: string): number | null {
  const written = /\d+/.exec(header);
  const number = written ? Number(written[0]) : 1;
  const countsTitular =
    TITULAR_COUNTED_WORDS.some((word) => header.includes(word)) &&
    !header.includes("acompanante") &&
    !header.includes("pareja");
  if (!countsTitular) return number >= 1 ? number : null;
  if (!written) return 1;
  return number >= 2 ? number - 1 : null;
}

function guessCompanions(normalized: string[], used: Set<number>): CompanionMapping[] {
  const byNumber = new Map<number, CompanionMapping>();
  normalized.forEach((header, column) => {
    if (!isCompanionHeader(header)) return;
    const part = isInstagramHeader(header)
      ? "instagram"
      : header.includes("nombre")
        ? "name"
        : null;
    const number = companionNumber(header);
    if (part === null || number === null) return;
    const pair = byNumber.get(number) ?? {};
    if (pair[part] !== undefined) return;
    pair[part] = column;
    byNumber.set(number, pair);
    used.add(column);
  });
  return [...byNumber.entries()]
    .sort(([first], [second]) => first - second)
    .map(([, pair]) => pair)
    .slice(0, MAX_IMPORT_COMPANIONS);
}

export function guessMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((header) =>
    header
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim(),
  );
  const used = new Set<number>();
  const companions = guessCompanions(normalized, used);
  const rules: [ImportField, (header: string) => boolean][] = [
    ["timestamp", (header) => header.includes("marca temporal") || header.includes("timestamp")],
    ["guest1Instagram", isInstagramHeader],
    ["guest1Name", (header) => header.includes("nombre")],
    ["allergies", (header) => header.includes("alergi")],
    ["notes", (header) => /nota|comentario|observacion/.test(header)],
  ];
  const mapping: ColumnMapping = {};
  for (const [field, matches] of rules) {
    const index = normalized.findIndex((header, column) => !used.has(column) && matches(header));
    if (index !== -1) {
      mapping[field] = index;
      used.add(index);
    }
  }
  if (companions.length > 0) mapping.companions = companions;
  return mapping;
}
