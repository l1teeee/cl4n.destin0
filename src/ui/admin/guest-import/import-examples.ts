export const EXAMPLE_HEADERS = [
  "Marca temporal",
  "Nombre completo",
  "Usuario de Instagram",
  "Nombre de tu acompañante",
  "Instagram de tu acompañante",
  "¿Tienes alguna alergia?",
  "Comentarios",
] as const;

export const EXAMPLE_ROWS: readonly (readonly string[])[] = [
  ["10/11/2026 16:02:33", "Ana López", "@ana.lopez", "", "", "No", ""],
  [
    "10/11/2026 16:05:10",
    "Carlos Mejía",
    "@carlos.mejia",
    "Luis Pérez",
    "@luis.perez",
    "Luis: maní",
    "Llegamos juntos",
  ],
];

function quoteCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function exampleCsv(): string {
  return [EXAMPLE_HEADERS, ...EXAMPLE_ROWS]
    .map((row) => row.map(quoteCsvField).join(","))
    .join("\r\n");
}

export function exampleJson(): string {
  const objects = EXAMPLE_ROWS.map((row) =>
    Object.fromEntries(EXAMPLE_HEADERS.map((header, index) => [header, row[index] ?? ""])),
  );
  return JSON.stringify(objects, null, 2);
}
