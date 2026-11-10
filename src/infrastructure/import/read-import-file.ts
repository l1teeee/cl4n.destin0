import { parseCsv } from "@/domain/guest-import/csv";
import { ImportTableError } from "@/domain/guest-import/import-rows";

import { readXlsxFirstSheet } from "./xlsx-reader";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function readImportFile(
  name: string,
  bytes: Uint8Array,
): Promise<{ headers: string[]; rows: string[][] }> {
  try {
    if (name.toLowerCase().endsWith(".json")) {
      const data: unknown = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      if (
        !Array.isArray(data) ||
        !data.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))
      ) {
        throw new ImportTableError("El JSON debe ser una lista de respuestas.");
      }
      const records = data as Record<string, unknown>[];
      const headers = [...new Set(records.flatMap((row) => Object.keys(row)))];
      return {
        headers,
        rows: records.map((row) => headers.map((header) => cellText(row[header]))),
      };
    }
    const table = name.toLowerCase().endsWith(".xlsx")
      ? readXlsxFirstSheet(bytes)
      : parseCsv(new TextDecoder("utf-8").decode(bytes));
    return { headers: table[0] ?? [], rows: table.slice(1) };
  } catch (error) {
    if (error instanceof ImportTableError) throw error;
    throw new ImportTableError("No se pudo leer el archivo.");
  }
}
