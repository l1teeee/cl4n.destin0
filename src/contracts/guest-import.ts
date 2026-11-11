import { z } from "zod";

export const IMPORT_FIELDS = [
  "timestamp",
  "guest1Name",
  "guest1Instagram",
  "allergies",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  timestamp: "Marca temporal",
  guest1Name: "Nombre",
  guest1Instagram: "Instagram",
  allergies: "Alergias",
  notes: "Notas",
};
export const MAX_IMPORT_FILE_BYTES = 1_048_576;
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_COLUMNS = 40;
export const IMPORT_FILE_EXTENSIONS = [".csv", ".xlsx", ".json"] as const;
export const MAX_IMPORT_COMPANIONS = 99;
export interface CompanionMapping {
  name?: number;
  instagram?: number;
}
export type ColumnMapping = Partial<Record<ImportField, number>> & {
  companions?: CompanionMapping[];
};

export function companionLabel(position: number, part: "name" | "instagram"): string {
  return `Acompañante ${position} · ${part === "name" ? "Nombre" : "Instagram"}`;
}

const columnIndex = z
  .number()
  .int()
  .min(0)
  .max(MAX_IMPORT_COLUMNS - 1);
export const columnMappingSchema: z.ZodType<ColumnMapping> = z
  .object({
    timestamp: columnIndex.optional(),
    guest1Name: columnIndex,
    guest1Instagram: columnIndex,
    allergies: columnIndex.optional(),
    notes: columnIndex.optional(),
    companions: z
      .array(z.object({ name: columnIndex.optional(), instagram: columnIndex.optional() }).strict())
      .max(MAX_IMPORT_COMPANIONS)
      .optional(),
  })
  .strict()
  .refine(
    (mapping) => {
      const { companions = [], ...base } = mapping;
      const columns = [
        ...Object.values(base),
        ...companions.flatMap((pair) => [pair.name, pair.instagram]),
      ].filter((column) => column !== undefined);
      return new Set(columns).size === columns.length;
    },
    { message: "Cada columna solo puede usarse una vez." },
  );

export interface ImportPreviewRow {
  rowNumber: number;
  order: number | null;
  timestamp: string | null;
  guests: { name: string; instagram: string }[];
  partySize: number;
  allergies: string | null;
  notes: string | null;
  error: string | null;
}

export interface ImportPreviewResponse {
  headers: string[];
  mapping: ColumnMapping;
  maxPartySize: number;
  rows: ImportPreviewRow[];
  summary: { valid: number; invalid: number; availableSeats: number; waitlistAvailable: number };
}

export type ImportRowResult =
  | "RECEIVED"
  | "WAITLISTED"
  | "DUPLICATE"
  | "EVENT_FULL"
  | "PARTY_SIZE_NOT_ALLOWED"
  | "EVENT_NOT_OPEN"
  | "CHANGED"
  | "INVALID"
  | "NOT_PROCESSED";

export interface ImportRowOutcome {
  rowNumber: number;
  result: ImportRowResult;
  reservationNumber?: number;
  waitlistPosition?: number;
  message: string;
}

export interface ImportRunResponse {
  importId: string;
  outcomes: ImportRowOutcome[];
  summary: { received: number; waitlisted: number; skipped: number };
}

export interface ImportErrorResponse {
  error: string;
}
