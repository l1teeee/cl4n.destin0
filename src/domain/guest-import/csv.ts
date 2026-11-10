function detectDelimiter(text: string): string {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (character === "\r" || character === "\n") break;
      if (character === ",") commas += 1;
      if (character === ";") semicolons += 1;
    }
  }
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\r" || character === "\n")) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Unclosed CSV field");
  row.push(cell);
  rows.push(row);
  while (rows.length && rows[rows.length - 1]!.every((value) => value.trim() === "")) {
    rows.pop();
  }
  return rows;
}
