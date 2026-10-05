import { describe, expect, it } from "vitest";

import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";

describe("formatPublicEventDate", () => {
  it("formats the instant in Spanish and America/El_Salvador", () => {
    expect(formatPublicEventDate(new Date("2026-11-22T01:30:00.000Z"))).toBe(
      "Sábado 21 de noviembre, 7:30 p. m.",
    );
  });

  it("keeps the previous local day when UTC has crossed midnight", () => {
    expect(formatPublicEventDate(new Date("2026-01-01T03:15:00.000Z"))).toBe(
      "Miércoles 31 de diciembre, 9:15 p. m.",
    );
  });
});
