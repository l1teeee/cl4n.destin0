import {
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  type ColumnMapping,
  type ImportField,
  type ImportPreviewRow,
} from "@/contracts/guest-import";
import { normalizeInstagram } from "@/domain/reservation/contact-normalization";

export class ImportTableError extends Error {}

function parseTimestamp(value: string): string | null {
  if (/^\d{1,7}(\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (serial < 1 || serial > 2958465) return null;
    const seconds = Math.round(serial * 24 * 60 * 60);
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + seconds * 1000 + 6 * 60 * 60 * 1000).toISOString();
  }
  const dayFirst = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (dayFirst) {
    const [, day, month, year, hour, minute, second = "0"] = dayFirst;
    const date = new Date(Date.UTC(+year!, +month! - 1, +day!, +hour!, +minute!, +second));
    if (
      date.getUTCFullYear() !== +year! ||
      date.getUTCMonth() !== +month! - 1 ||
      date.getUTCDate() !== +day! ||
      date.getUTCHours() !== +hour! ||
      date.getUTCMinutes() !== +minute! ||
      date.getUTCSeconds() !== +second
    ) {
      return null;
    }
    // El Salvador is UTC-6 throughout the year.
    return new Date(date.getTime() + 6 * 60 * 60 * 1000).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
    return null;
  }
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}-06:00`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validateRow(
  row: ImportPreviewRow,
  companionNumbers: number[],
  maxPartySize: number,
): string | null {
  const control = /[\u0000-\u001f\u007f]/;
  const noteControl = /[\u0000-\u0008\u000b-\u001f\u007f]/;
  if (
    row.guests.some((guest) => control.test(guest.name) || control.test(guest.instagram)) ||
    [row.allergies, row.notes].some((value) => value !== null && noteControl.test(value))
  ) {
    return "No se permiten caracteres de control.";
  }
  if (!row.guests[0]!.name) return "El nombre completo es obligatorio.";
  if (row.guests.some((guest) => guest.name.length > 120)) {
    return "El nombre completo no puede superar 120 caracteres.";
  }
  if (!row.guests[0]!.instagram) return "El usuario de Instagram es obligatorio.";
  for (const [index, number] of companionNumbers.entries()) {
    const companion = row.guests[index + 1]!;
    if (!companion.name || !companion.instagram) {
      return `Completa nombre e Instagram del acompañante ${number}.`;
    }
  }
  const handles = new Set<string>();
  for (const guest of row.guests) {
    const normalized = normalizeInstagram(guest.instagram);
    if (!normalized.ok) return "Ingresa un usuario de Instagram válido.";
    guest.instagram = normalized.value;
    if (handles.has(normalized.value)) {
      return "Cada invitado necesita su propio usuario de Instagram.";
    }
    handles.add(normalized.value);
  }
  if (row.partySize > maxPartySize) {
    return `Esta experiencia acepta hasta ${maxPartySize} personas por solicitud.`;
  }
  if ((row.allergies?.length ?? 0) > 300) {
    return "La descripción de alergias no puede superar 300 caracteres.";
  }
  if ((row.notes?.length ?? 0) > 500) return "Las observaciones no pueden superar 500 caracteres.";
  return null;
}

export function buildImportRows(
  table: { headers: string[]; rows: string[][] },
  mapping: ColumnMapping,
  maxPartySize: number,
): ImportPreviewRow[] {
  if (!table.headers.length) throw new ImportTableError("El archivo no tiene encabezados.");
  if (
    table.headers.length > MAX_IMPORT_COLUMNS ||
    table.rows.some((row) => row.length > MAX_IMPORT_COLUMNS)
  ) {
    throw new ImportTableError("El archivo tiene más de 40 columnas.");
  }
  const nonEmpty = table.rows
    .map((cells, index) => ({ cells: cells.map((cell) => cell.trim()), rowNumber: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cell !== ""));
  if (nonEmpty.length > MAX_IMPORT_ROWS)
    throw new ImportTableError("El archivo tiene más de 200 filas.");
  if (!nonEmpty.length) throw new ImportTableError("El archivo no tiene respuestas.");
  const seen = new Map<string, number>();
  const rows = nonEmpty.map(({ cells, rowNumber }): ImportPreviewRow => {
    const cellAt = (column: number | undefined) => cells[column ?? -1] ?? "";
    const cell = (field: ImportField) => cellAt(mapping[field]);
    const allergies = cell("allergies");
    const normalizedAllergies = allergies
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const guests = [{ name: cell("guest1Name"), instagram: cell("guest1Instagram") }];
    const companionNumbers: number[] = [];
    for (const [index, pair] of (mapping.companions ?? []).entries()) {
      const name = cellAt(pair.name);
      const instagram = cellAt(pair.instagram);
      if (!name && !instagram) continue;
      guests.push({ name, instagram });
      companionNumbers.push(index + 1);
    }
    const row: ImportPreviewRow = {
      rowNumber,
      order: null,
      timestamp: mapping.timestamp === undefined ? null : parseTimestamp(cell("timestamp")),
      guests,
      partySize: guests.length,
      allergies: ["", "no", "ninguna", "ninguno", "n/a", "na", "-"].includes(normalizedAllergies)
        ? null
        : allergies,
      notes: cell("notes") || null,
      error: null,
    };
    if (mapping.guest1Name === undefined || mapping.guest1Instagram === undefined) {
      row.error = "Elige las columnas de nombre e Instagram.";
    } else {
      row.error = validateRow(row, companionNumbers, maxPartySize);
      if (!row.error && mapping.timestamp !== undefined && !row.timestamp) {
        row.error = "No se pudo leer la marca temporal.";
      }
      if (!row.error) {
        const handles = row.guests.map((guest) => guest.instagram);
        const duplicate = handles
          .map((handle) => seen.get(handle))
          .find((number) => number !== undefined);
        if (duplicate !== undefined) row.error = `Duplicada con la fila ${duplicate}.`;
        else for (const handle of handles) seen.set(handle, rowNumber);
      }
    }
    return row;
  });
  const valid = rows.filter((row) => !row.error);
  valid.sort((a, b) => {
    const time =
      mapping.timestamp === undefined ? 0 : Date.parse(a.timestamp!) - Date.parse(b.timestamp!);
    return time || a.rowNumber - b.rowNumber;
  });
  valid.forEach((row, index) => {
    row.order = index + 1;
  });
  return rows;
}
