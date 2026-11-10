import { describe, expect, it } from "vitest";

import { columnMappingSchema } from "@/contracts/guest-import";
import { guessMapping } from "@/domain/guest-import/column-mapping";

describe("guest import column mapping", () => {
  it("maps Google Forms Spanish headers", () => {
    expect(
      guessMapping([
        "Marca temporal",
        "Nombre completo",
        "Usuario de Instagram",
        "Nombre de tu acompañante",
        "Instagram de tu acompañante",
        "¿Tienes alguna alergia?",
        "Comentarios",
      ]),
    ).toEqual({
      timestamp: 0,
      guest1Name: 1,
      guest1Instagram: 2,
      guest2Name: 3,
      guest2Instagram: 4,
      allergies: 5,
      notes: 6,
    });
  });

  it.each(["acompañante", "pareja", "invitado 2", "persona 2", "segunda persona"])(
    "prioritizes companion columns for %s and normalizes case and accents",
    (word) => {
      expect(
        guessMapping([
          `  USUÁRIO ${word} `,
          `NOMBRE ${word}`,
          "@",
          "Nombre",
          "Observación",
          "Timestamp",
        ]),
      ).toEqual({
        guest2Instagram: 0,
        guest2Name: 1,
        guest1Instagram: 2,
        guest1Name: 3,
        notes: 4,
        timestamp: 5,
      });
    },
  );

  it("takes the first match once and leaves missing fields unmapped", () => {
    expect(guessMapping(["Nombre Instagram", "Nombre", "Nombre", "irrelevante"])).toEqual({
      guest1Instagram: 0,
      guest1Name: 1,
    });
    expect(guessMapping([])).toEqual({});
  });

  it("requires primary fields and distinct integer column indices in range", () => {
    expect(columnMappingSchema.safeParse({ guest1Name: 0, guest1Instagram: 39 }).success).toBe(
      true,
    );
    for (const mapping of [
      {},
      { guest1Name: 0 },
      { guest1Name: 0, guest1Instagram: 0 },
      { guest1Name: -1, guest1Instagram: 1 },
      { guest1Name: 0, guest1Instagram: 40 },
      { guest1Name: 0.5, guest1Instagram: 1 },
      { guest1Name: "0", guest1Instagram: 1 },
      { guest1Name: 0, guest1Instagram: 1, extra: 2 },
    ]) {
      expect(columnMappingSchema.safeParse(mapping).success).toBe(false);
    }
  });
});
