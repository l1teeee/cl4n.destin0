const spreadsheetFormulaPrefixes = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (spreadsheetFormulaPrefixes.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function createCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}
