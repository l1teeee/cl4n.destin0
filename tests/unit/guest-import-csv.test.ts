import { describe, expect, it } from "vitest";

import { parseCsv } from "@/domain/guest-import/csv";

describe("parseCsv", () => {
  it("reads quoted fields, escaped quotes and delimiters inside quotes", () => {
    expect(parseCsv('Nombre,Notas\n"Ana, María","Dijo ""sí"""')).toEqual([
      ["Nombre", "Notas"],
      ["Ana, María", 'Dijo "sí"'],
    ]);
  });

  it("preserves embedded LF and CRLF while splitting unquoted line endings", () => {
    expect(parseCsv('a,b\r\n"uno\r\ndos","tres\ncuatro"\r\nx,y\n')).toEqual([
      ["a", "b"],
      ["uno\r\ndos", "tres\ncuatro"],
      ["x", "y"],
    ]);
  });

  it("strips BOM, detects semicolons outside quotes and drops trailing blank lines", () => {
    expect(parseCsv('\uFEFF"Nombre,,,";Instagram\r\nAna;@ana\r\n;\r\n\n')).toEqual([
      ["Nombre,,,", "Instagram"],
      ["Ana", "@ana"],
    ]);
  });

  it("uses commas when delimiter counts tie and retains interior empty lines", () => {
    expect(parseCsv("a,b;c\n\nx,y;z")).toEqual([["a", "b;c"], [""], ["x", "y;z"]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('a,b\n"unfinished')).toThrow();
  });
});
