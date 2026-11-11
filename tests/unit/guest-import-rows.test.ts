import { describe, expect, it } from "vitest";

import type { ColumnMapping } from "@/contracts/guest-import";
import { guestRequestSchema } from "@/contracts/guest-request";
import { buildImportRows, ImportTableError } from "@/domain/guest-import/import-rows";
import { importRowFingerprint, importRowKey } from "@/infrastructure/import/import-keys";
import { readImportFile } from "@/infrastructure/import/read-import-file";

const headers = ["Nombre", "Instagram", "Acompañante", "Instagram 2", "Alergias", "Notas", "Fecha"];
const mapping: ColumnMapping = {
  guest1Name: 0,
  guest1Instagram: 1,
  companions: [{ name: 2, instagram: 3 }],
  allergies: 4,
  notes: 5,
};

function rows(data: string[][], selectedMapping = mapping, maxPartySize = 2) {
  return buildImportRows({ headers, rows: data }, selectedMapping, maxPartySize);
}

describe("buildImportRows", () => {
  it("trims, normalizes Instagram URLs and handles, and skips empty rows with original row numbers", () => {
    expect(
      rows([
        [" ", ""],
        [" Ana ", "https://www.instagram.com/ANA/", "Luis", "@LUIS", "No", " hola "],
      ]),
    ).toEqual([
      {
        rowNumber: 3,
        order: 1,
        timestamp: null,
        guests: [
          { name: "Ana", instagram: "ana" },
          { name: "Luis", instagram: "luis" },
        ],
        partySize: 2,
        allergies: null,
        notes: "hola",
        error: null,
      },
    ]);
  });

  it.each(["", "No", "NINGUNA", "ninguno", "n/a", "NA", "-", "Nó"])(
    "treats %s allergies as null",
    (allergies) => {
      expect(rows([["Ana", "ana", "", "", allergies]])[0]!.allergies).toBeNull();
    },
  );

  it.each([
    [["", "ana"], "El nombre completo es obligatorio."],
    [["a".repeat(121), "ana"], "El nombre completo no puede superar 120 caracteres."],
    [["Ana", ""], "El usuario de Instagram es obligatorio."],
    [["Ana", "not a handle"], "Ingresa un usuario de Instagram válido."],

    [["Ana", "ana", "Luis", "bad!"], "Ingresa un usuario de Instagram válido."],
    [
      ["Ana", "ana", "a".repeat(121), "luis"],
      "El nombre completo no puede superar 120 caracteres.",
    ],
    [["Ana", "ana", "Ana", "@ANA"], "Cada invitado necesita su propio usuario de Instagram."],
    [
      ["Ana", "ana", "", "", "x".repeat(301)],
      "La descripción de alergias no puede superar 300 caracteres.",
    ],
    [
      ["Ana", "ana", "", "", "", "x".repeat(501)],
      "Las observaciones no pueden superar 500 caracteres.",
    ],
    [["Ana\u0000", "ana"], "No se permiten caracteres de control."],
    [["Ana", "ana", "", "", "x\u0000"], "No se permiten caracteres de control."],
    [["Ana", "ana", "", "", "", "x\u0000"], "No se permiten caracteres de control."],
  ] as [string[], string][])("validates %j using the public messages", (data, message) => {
    expect(rows([data])[0]).toMatchObject({ order: null, error: message });
    const publicResult = guestRequestSchema.safeParse({
      eventSlug: "event",
      guests: [
        { name: data[0], instagram: data[1] },
        ...(data[2] || data[3]
          ? [{ name: data[2] || undefined, instagram: data[3] || undefined }]
          : []),
      ],
      hasAllergies: Boolean(data[4]),
      allergies: data[4] || undefined,
      notes: data[5] || undefined,
      acceptTerms: true,
      turnstileToken: "token",
    });
    expect(publicResult.success).toBe(false);
    if (!publicResult.success)
      expect(publicResult.error.issues.map((issue) => issue.message)).toContain(message);
  });

  it("builds a row with three companions as four guests", () => {
    const groupMapping: ColumnMapping = {
      guest1Name: 0,
      guest1Instagram: 1,
      companions: [
        { name: 2, instagram: 3 },
        { name: 4, instagram: 5 },
        { name: 6, instagram: 7 },
      ],
    };
    const [row] = buildImportRows(
      {
        headers: ["N", "I", "N1", "I1", "N2", "I2", "N3", "I3"],
        rows: [["Ana", "ana", "Luis", "@LUIS", "Eva", "eva", "Leo", "leo"]],
      },
      groupMapping,
      4,
    );
    expect(row).toMatchObject({ partySize: 4, error: null });
    expect(row!.guests.map((guest) => guest.instagram)).toEqual(["ana", "luis", "eva", "leo"]);
  });

  it.each([
    [["Ana", "ana", "Luis"], "Completa nombre e Instagram del acompañante 1."],
    [["Ana", "ana", "", "luis"], "Completa nombre e Instagram del acompañante 1."],
  ] as [string[], string][])("flags half companion pairs in %j", (data, message) => {
    expect(rows([data])[0]).toMatchObject({ order: null, error: message });
  });

  it("flags rows over the event max party size", () => {
    expect(rows([["Ana", "ana", "Luis", "luis"]], mapping, 1)[0]!.error).toBe(
      "Esta experiencia acepta hasta 1 personas por solicitud.",
    );
  });

  it("allows boundary lengths and newlines in allergies and notes", () => {
    expect(
      rows([
        [
          "a".repeat(120),
          "ana",
          "b".repeat(120),
          "luis",
          "a".repeat(299) + "\nx",
          "n".repeat(499) + "x",
        ],
      ])[0]!.error,
    ).toBe("La descripción de alergias no puede superar 300 caracteres.");
    expect(
      rows([
        [
          "a".repeat(120),
          "ana",
          "b".repeat(120),
          "luis",
          "a".repeat(298) + "\nx",
          "n".repeat(498) + "\nx",
        ],
      ])[0]!.error,
    ).toBeNull();
  });

  it("marks duplicates against earlier valid rows, including companion handles", () => {
    const result = rows([
      ["", "ana"],
      ["Ana", "ana", "Luis", "luis"],
      ["Luis", "@LUIS"],
      ["Eva", "eva", "Ana", "ana"],
      ["Eva", "eva"],
    ]);
    expect(result.map((row) => row.error)).toEqual([
      "El nombre completo es obligatorio.",
      null,
      "Duplicada con la fila 3.",
      "Duplicada con la fila 3.",
      null,
    ]);
    expect(result.map((row) => row.order)).toEqual([null, 1, null, null, 2]);
  });

  it("parses local Spanish timestamps and ISO, sorts valid rows only and breaks ties by row number", () => {
    const result = rows(
      [
        ["Ana", "ana", "", "", "", "", "10/11/2026 9:05:02"],
        ["Luis", "luis", "", "", "", "", "2026-11-10T14:00:00Z"],
        ["Eva", "eva", "", "", "", "", "10/11/2026 8:00"],
        ["Mal", "mal", "", "", "", "", "31/2/2026 8:00"],
      ],
      { ...mapping, timestamp: 6 },
    );
    expect(result.map((row) => row.order)).toEqual([3, 1, 2, null]);
    expect(result[0]!.timestamp).toBe("2026-11-10T15:05:02.000Z");
    expect(result[3]!.error).toBe("No se pudo leer la marca temporal.");
    expect(
      rows([["Ana", "ana", "", "", "", "", "2026-11-10T08:00:00"]], {
        ...mapping,
        timestamp: 6,
      })[0]!.timestamp,
    ).toBe("2026-11-10T14:00:00.000Z");
  });

  it("parses Google Sheets serial timestamps as El Salvador wall time rounded to a second", () => {
    const result = rows([["Ana", "ana", "", "", "", "", "46336.66844"]], {
      ...mapping,
      timestamp: 6,
    });
    expect(result[0]).toMatchObject({
      timestamp: "2026-11-10T22:02:33.000Z",
      order: 1,
      error: null,
    });
    expect(
      rows([["Ana", "ana", "", "", "", "", "1.000006"]], { ...mapping, timestamp: 6 })[0]!
        .timestamp,
    ).toBe("1899-12-31T06:00:01.000Z");
    expect(
      rows([["Ana", "ana", "", "", "", "", "2958465"]], { ...mapping, timestamp: 6 })[0]!.timestamp,
    ).toBe("9999-12-31T06:00:00.000Z");
  });

  it("orders serial timestamps alongside day-first and ISO timestamps", () => {
    const result = rows(
      [
        ["Ana", "ana", "", "", "", "", "46336.66844"],
        ["Luis", "luis", "", "", "", "", "46335.75"],
        ["Eva", "eva", "", "", "", "", "10/11/2026 16:02:33"],
        ["Leo", "leo", "", "", "", "", "2026-11-10T22:02:32Z"],
      ],
      { ...mapping, timestamp: 6 },
    );
    expect(result.map((row) => row.order)).toEqual([3, 1, 4, 2]);
    expect(rows([["Ana", "ana", "", "", "", "", "invalid serial"]])[0]!.error).toBeNull();
  });

  it.each(["0", "0.999", "2958465.1", "2958466", "12345678", "-1", "1e3"])(
    "rejects invalid serial timestamp %s",
    (timestamp) => {
      expect(
        rows([["Ana", "ana", "", "", "", "", timestamp]], { ...mapping, timestamp: 6 })[0],
      ).toMatchObject({
        timestamp: null,
        order: null,
        error: "No se pudo leer la marca temporal.",
      });
    },
  );

  it("requires name and Instagram mapping even when other fields are valid", () => {
    expect(rows([["Ana", "ana"]], {})[0]!.error).toBe("Elige las columnas de nombre e Instagram.");
  });

  it("enforces table limits without counting empty data rows", () => {
    expect(() => buildImportRows({ headers: [], rows: [] }, mapping, 2)).toThrow(ImportTableError);
    expect(() => rows([[" "]])).toThrow("El archivo no tiene respuestas.");
    expect(() =>
      buildImportRows({ headers: Array(41).fill("h"), rows: [["x"]] }, mapping, 2),
    ).toThrow("El archivo tiene más de 40 columnas.");
    expect(() => rows([Array(41).fill("x")])).toThrow("El archivo tiene más de 40 columnas.");
    expect(() => rows(Array.from({ length: 201 }, () => ["Ana", "ana"]))).toThrow(
      "El archivo tiene más de 200 filas.",
    );
    expect(
      rows([...Array.from({ length: 200 }, (_, i) => ["Ana", `ana${i}`]), [" "]]),
    ).toHaveLength(200);
  });
});

describe("import file decoding and keys", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("reads CSV and JSON with headers in first-seen order and empty null values", async () => {
    expect(await readImportFile("responses.CSV", bytes("Nombre,Instagram\nAna,ana"))).toEqual({
      headers: ["Nombre", "Instagram"],
      rows: [["Ana", "ana"]],
    });
    expect(
      await readImportFile(
        "responses.json",
        bytes('[{"Nombre":"Ana","Edad":2},{"Instagram":"ana","Edad":null}]'),
      ),
    ).toEqual({
      headers: ["Nombre", "Edad", "Instagram"],
      rows: [
        ["Ana", "2", ""],
        ["", "", "ana"],
      ],
    });
  });

  it.each(["{}", "[null]", "[[]]", '["text"]'])(
    "rejects JSON that is not a list of objects: %s",
    async (text) => {
      await expect(readImportFile("responses.json", bytes(text))).rejects.toThrow(
        "El JSON debe ser una lista de respuestas.",
      );
    },
  );

  it.each(["responses.csv", "responses.json", "responses.xlsx"])(
    "reports unreadable %s",
    async (name) => {
      await expect(readImportFile(name, bytes('"bad'))).rejects.toThrow(
        "No se pudo leer el archivo.",
      );
    },
  );

  it("derives stable UUID v8 row keys and fingerprints from normalized guest data", () => {
    const key = importRowKey("import", 2);
    expect(key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(importRowKey("import", 2)).toBe(key);
    expect(importRowKey("import", 3)).not.toBe(key);
    expect(importRowKey("other", 2)).not.toBe(key);
    const row = rows([["Ana", "@ANA"]])[0]!;
    expect(importRowFingerprint("event", row)).toMatch(/^[a-f0-9]{64}$/);
    expect(importRowFingerprint("event", row)).toBe(
      importRowFingerprint("event", { ...row, order: 20, timestamp: "changed" }),
    );
    expect(importRowFingerprint("event", row)).not.toBe(importRowFingerprint("other", row));
    expect(importRowFingerprint("event", row)).not.toBe(
      importRowFingerprint("event", { ...row, notes: "changed" }),
    );
  });
});
