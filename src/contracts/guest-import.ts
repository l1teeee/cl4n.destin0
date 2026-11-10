import { z } from "zod";

export const IMPORT_FIELDS = [
  "timestamp",
  "guest1Name",
  "guest1Instagram",
  "guest2Name",
  "guest2Instagram",
  "allergies",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  timestamp: "Marca temporal",
  guest1Name: "Nombre",
  guest1Instagram: "Instagram",
  guest2Name: "Nombre del acompañante",
  guest2Instagram: "Instagram del acompañante",
  allergies: "Alergias",
  notes: "Notas",
};
export const MAX_IMPORT_FILE_BYTES = 1_048_576;
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_COLUMNS = 40;
export const IMPORT_FILE_EXTENSIONS = [".csv", ".xlsx", ".json"] as const;
export type ColumnMapping = Partial<Record<ImportField, number>>;

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
    guest2Name: columnIndex.optional(),
    guest2Instagram: columnIndex.optional(),
    allergies: columnIndex.optional(),
    notes: columnIndex.optional(),
  })
  .strict()
  .refine((mapping) => new Set(Object.values(mapping)).size === Object.values(mapping).length, {
    message: "Cada columna solo puede usarse una vez.",
  });

export interface ImportPreviewRow {
  rowNumber: number;
  order: number | null;
  timestamp: string | null;
  guest1Name: string;
  guest1Instagram: string;
  guest2Name: string | null;
  guest2Instagram: string | null;
  partySize: 1 | 2;
  allergies: string | null;
  notes: string | null;
  error: string | null;
}

export interface ImportPreviewResponse {
  headers: string[];
  mapping: ColumnMapping;
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
