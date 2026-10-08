import { describe, expect, it } from "vitest";

import { createCsv, escapeCsvCell } from "@/infrastructure/http/csv";

describe("CSV escaping", () => {
  it.each(["=SUM(A1:A2)", "+1", "-2", "@cmd", "\tformula", "\rformula"])(
    "neutralizes spreadsheet formula prefix %j",
    (value) => {
      expect(escapeCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  it("quotes every field, doubles quotes, and preserves newlines and accents", () => {
    expect(createCsv([["José", 'Dijo "hola"', "línea 1\nlínea 2"]])).toBe(
      '"José","Dijo ""hola""","línea 1\nlínea 2"',
    );
  });
});
