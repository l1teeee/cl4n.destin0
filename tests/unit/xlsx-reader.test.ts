import { describe, expect, it } from "vitest";

import { MAX_IMPORT_FILE_BYTES } from "@/contracts/guest-import";
import { ImportTableError } from "@/domain/guest-import/import-rows";
import { readImportFile } from "@/infrastructure/import/read-import-file";
import { readXlsxFirstSheet } from "@/infrastructure/import/xlsx-reader";

import { buildXlsx, buildZip } from "../helpers/xlsx-builder";

const genericError = "No se pudo leer el archivo.";
const singleSheet = {
  sheets: [
    [
      ["Nombre", "Instagram"],
      ["Ana", "ana"],
    ],
  ],
};

function worksheet(rows: string): string {
  return `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
}

function customSheet(xml: string, sharedStringsXml?: string): Buffer {
  return buildXlsx({ sheets: [[]], sharedStrings: false }, { sheetXml: [xml], sharedStringsXml });
}

describe("readXlsxFirstSheet", () => {
  it.each([false, true])("reads shared strings from %s stored ZIP entries", (stored) => {
    expect(readXlsxFirstSheet(buildXlsx(singleSheet, { stored }))).toEqual(singleSheet.sheets[0]);
  });

  it("reads rich-text shared strings, plain text, entities and self-closing text", () => {
    const shared =
      "<sst><si><r><t>Ana &amp; </t></r><r><rPr><b/></rPr><t>María</t></r><t/></si><si><t>&lt;&gt;&quot;&apos;&#65;&#x1F600;</t></si><si><t/></si></sst>";
    const sheet = worksheet(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>',
    );
    expect(readXlsxFirstSheet(customSheet(sheet, shared))).toEqual([
      ["Ana & María", "<>\"'A😀", ""],
    ]);
  });

  it("reads inline strings with rich-text runs and preserved whitespace", () => {
    expect(readXlsxFirstSheet(buildXlsx({ ...singleSheet, inlineStrings: true }))).toEqual(
      singleSheet.sheets[0],
    );
    const sheet = worksheet(
      '<row><c t="inlineStr"><is><r><t xml:space="preserve">  Ana </t></r><r><t>&amp; Luis </t></r><t/></is></c><c t="inlineStr"><is><t/></is></c></row>',
    );
    expect(readXlsxFirstSheet(customSheet(sheet))).toEqual([["  Ana & Luis ", ""]]);
  });

  it("reads booleans, raw numbers and cached values while ignoring formulas and cell errors", () => {
    const sheet = worksheet(
      '<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1"><v>46336.66844</v></c><c r="D1"><f>1+2</f><v>3</v></c><c r="E1"><f>A1+B1</f></c><c r="F1" t="e"><v>#VALUE!</v></c><c r="G1" t="str"><v>&amp;lt; &#233;</v></c><c r="H1"/></row>',
    );
    expect(readXlsxFirstSheet(customSheet(sheet))).toEqual([
      ["TRUE", "FALSE", "46336.66844", "3", "", "", "&lt; é", ""],
    ]);
  });

  it("reads numeric cells without sharedStrings.xml", () => {
    const data = { sheets: [[["123", "-4.5", "TRUE", "FALSE"]]], sharedStrings: false };
    expect(readXlsxFirstSheet(buildXlsx(data))).toEqual(data.sheets[0]);
  });

  it("fills missing cells and rows, uses running references, and drops empty trailing rows", () => {
    const sheet = worksheet(
      '<row r="1"><c r="B1"><v>1</v></c><c/><c><v>2</v></c></row><row r="3"><c t="inlineStr"><is><t>Ana</t></is></c></row><row><c><v>4</v></c></row><row r="9"><c/></row>',
    );
    expect(readXlsxFirstSheet(customSheet(sheet))).toEqual([
      ["", "1", "", "2"],
      ["", "", "", ""],
      ["Ana", "", "", ""],
      ["4", "", "", ""],
    ]);
  });

  it("returns no rows for an empty sheet", () => {
    expect(readXlsxFirstSheet(buildXlsx({ sheets: [[]] }))).toEqual([]);
  });

  it("reads only the first listed sheet, ignoring malformed and oversized unused entries", () => {
    const data = { sheets: [[["First"]], [["Second"]]] };
    const bytes = buildXlsx(data, {
      sheetXml: [worksheet('<row><c t="inlineStr"><is><t>First</t></is></c></row>'), "broken XML"],
      extraEntries: [{ name: "unused.xml", data: Buffer.alloc(17 * 1024 * 1024), method: 12 }],
    });
    expect(readXlsxFirstSheet(bytes)).toEqual([["First"]]);
  });

  it.each([
    "worksheets/sheet2.xml",
    "./worksheets/../worksheets/sheet2.xml",
    "/xl/worksheets/sheet2.xml",
  ])("resolves the first sheet's relationship Target %s", (target) => {
    const bytes = buildXlsx(
      { sheets: [[["One"]], [["Two"]]], inlineStrings: true },
      {
        workbookXml:
          '<workbook xmlns:r="relationships"><sheets><sheet r:id="second"/><sheet r:id="first"/></sheets></workbook>',
        relationshipsXml: `<Relationships><Relationship Target="${target}" Id="second"/><Relationship Id="first" Target="worksheets/sheet1.xml"/></Relationships>`,
      },
    );
    expect(readXlsxFirstSheet(bytes)).toEqual([["Two"]]);
  });

  it("falls back to sheet1 only when the workbook has no sheet relationship", () => {
    expect(
      readXlsxFirstSheet(
        buildXlsx(singleSheet, {
          workbookXml: '<workbook><sheets><sheet name="Fallback"/></sheets></workbook>',
        }),
      ),
    ).toEqual(singleSheet.sheets[0]);
    expect(() =>
      readXlsxFirstSheet(buildXlsx(singleSheet, { relationshipsXml: "<Relationships/>" })),
    ).toThrow(genericError);
  });

  it("accepts an EOCD comment of the maximum allowed length", () => {
    const bytes = buildXlsx(singleSheet);
    bytes.writeUInt16LE(65_535, bytes.length - 2);
    const comment = Buffer.alloc(65_535);
    comment.writeUInt32LE(0x06054b50, comment.length - 40);
    expect(readXlsxFirstSheet(Buffer.concat([bytes, comment]))).toEqual(singleSheet.sheets[0]);
  });

  it("handles XML declarations, comments, CDATA and namespace prefixes", () => {
    const sheet =
      '<?xml version="1.0" encoding="UTF-8"?><!-- comment > --><x:worksheet xmlns:x="sheet"><x:sheetData><x:row><x:c t="inlineStr"><x:is><x:t><![CDATA[A & B]]></x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>';
    expect(readXlsxFirstSheet(customSheet(sheet))).toEqual([["A & B"]]);
  });

  it.each([Buffer.alloc(0), Buffer.from("not a zip"), Buffer.from("PK\u0003\u0004")])(
    "rejects invalid ZIP bytes %j",
    (bytes) => {
      expect(() => readXlsxFirstSheet(bytes)).toThrow(ImportTableError);
      expect(() => readXlsxFirstSheet(bytes)).toThrow(genericError);
    },
  );

  it.each([
    { encrypted: true },
    { method: 12 },
    { wrongUncompressedSize: true },
    { zip64: true },
    { extraEntries: 2_001 },
  ])("rejects ZIP faults %j", (fault) => {
    expect(() => readXlsxFirstSheet(buildXlsx(singleSheet, fault))).toThrow(genericError);
  });

  it("rejects encryption on an unused entry as well", () => {
    expect(() =>
      readXlsxFirstSheet(
        buildXlsx(singleSheet, { extraEntries: [{ name: "unused", data: "", flags: 1 }] }),
      ),
    ).toThrow(genericError);
  });

  it.each([12, 16])("rejects ZIP64 markers in EOCD field %s", (field) => {
    const bytes = buildXlsx(singleSheet);
    bytes.writeUInt32LE(0xffffffff, bytes.length - 22 + field);
    expect(() => readXlsxFirstSheet(bytes)).toThrow(genericError);
  });

  it.each([20, 24, 42])("rejects ZIP64 markers in central entry field %s", (field) => {
    const bytes = buildXlsx(singleSheet);
    const central = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE(0xffffffff, central + field);
    expect(() => readXlsxFirstSheet(bytes)).toThrow(genericError);
  });

  it.each([18, 22])("rejects ZIP64 markers in local entry field %s", (field) => {
    const bytes = buildXlsx(singleSheet);
    const local = bytes.indexOf("xl/workbook.xml") - 30;
    bytes.writeUInt32LE(0xffffffff, local + field);
    expect(() => readXlsxFirstSheet(bytes)).toThrow(genericError);
  });

  it("rejects truncated archives, bad signatures, out-of-range offsets and duplicate names", () => {
    const bytes = buildXlsx(singleSheet);
    expect(() => readXlsxFirstSheet(bytes.subarray(0, bytes.length - 1))).toThrow(genericError);
    const badSignature = Buffer.from(bytes);
    const central = bytes.readUInt32LE(bytes.length - 6);
    badSignature.writeUInt32LE(0, central);
    expect(() => readXlsxFirstSheet(badSignature)).toThrow(genericError);
    const badOffset = Buffer.from(bytes);
    badOffset.writeUInt32LE(bytes.length + 1, central + 42);
    expect(() => readXlsxFirstSheet(badOffset)).toThrow(genericError);
    expect(() =>
      readXlsxFirstSheet(
        buildXlsx(singleSheet, { extraEntries: [{ name: "xl/workbook.xml", data: "duplicate" }] }),
      ),
    ).toThrow(genericError);
    const badPayload = Buffer.from(bytes);
    const local = bytes.indexOf("xl/workbook.xml") - 30;
    badPayload.writeUInt32LE(0, local);
    expect(() => readXlsxFirstSheet(badPayload)).toThrow(genericError);
  });

  it("requires workbook, relationships and resolved sheet entries", () => {
    expect(() => readXlsxFirstSheet(buildZip([]))).toThrow(genericError);
    expect(() =>
      readXlsxFirstSheet(buildZip([{ name: "xl/workbook.xml", data: "<workbook/>" }])),
    ).toThrow(genericError);
    expect(() =>
      readXlsxFirstSheet(
        buildXlsx(singleSheet, {
          relationshipsXml:
            '<Relationships><Relationship Id="rId1" Target="worksheets/missing.xml"/></Relationships>',
        }),
      ),
    ).toThrow(genericError);
    expect(() =>
      readXlsxFirstSheet(
        buildXlsx(singleSheet, {
          relationshipsXml:
            '<Relationships><Relationship Id="rId1" Target="https://example.com/sheet.xml" TargetMode="External"/></Relationships>',
        }),
      ),
    ).toThrow(genericError);
  });

  it.each([
    '<row><c t="s"><v>0</v></c></row>',
    '<row><c t="s"><v>9</v></c></row>',
    '<row><c t="s"><v>-1</v></c></row>',
    '<row><c t="s"/></row>',
    '<row><c t="b"><v>2</v></c></row>',
  ])("rejects invalid or missing cell values in %s", (row) => {
    expect(() => readXlsxFirstSheet(customSheet(worksheet(row)))).toThrow(genericError);
  });

  it("rejects a shared-string index outside an existing table", () => {
    const sheet = worksheet('<row><c t="s"><v>1</v></c></row>');
    expect(() => readXlsxFirstSheet(customSheet(sheet, "<sst><si><t>Only</t></si></sst>"))).toThrow(
      genericError,
    );
  });

  it.each([
    "<worksheet>",
    "<worksheet><sheetData></worksheet>",
    '<!DOCTYPE worksheet [<!ENTITY secret SYSTEM "file:///secret">]><worksheet/>',
    "<worksheet value=unquoted/>",
    worksheet("<row><c><v>&unknown;</v></c></row>"),
    worksheet("<row><c><v>&#0;</v></c></row>"),
    worksheet('<row r="0"><c><v>1</v></c></row>'),
    worksheet('<row r="1048577"><c><v>1</v></c></row>'),
    worksheet('<row><c r="invalid"><v>1</v></c></row>'),
    worksheet('<row><c r="B1"><v>1</v></c><c r="A1"><v>2</v></c></row>'),
  ])("rejects structurally invalid XML %s", (xml) => {
    expect(() => readXlsxFirstSheet(customSheet(xml))).toThrow(genericError);
  });

  it("bounds deflate output even when an entry lies about its uncompressed size", () => {
    const bytes = buildZip([
      {
        name: "xl/workbook.xml",
        data: Buffer.alloc(17 * 1024 * 1024),
        uncompressedSize: 10 * 1024 * 1024,
      },
    ]);
    expect(bytes.length).toBeLessThan(MAX_IMPORT_FILE_BYTES);
    expect(() => readXlsxFirstSheet(bytes)).toThrow(genericError);
  });

  it("rejects 40 MiB of extracted zeros across otherwise valid XML entries", () => {
    const padded = (xml: string) => `${xml}<!--${"0".repeat(10 * 1024 * 1024 - xml.length - 7)}-->`;
    const bytes = buildZip([
      {
        name: "xl/workbook.xml",
        data: padded('<workbook xmlns:r="rel"><sheets><sheet r:id="first"/></sheets></workbook>'),
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: padded(
          '<Relationships><Relationship Id="first" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
      },
      { name: "xl/sharedStrings.xml", data: padded("<sst/>") },
      { name: "xl/worksheets/sheet1.xml", data: padded(worksheet("<row><c><v>1</v></c></row>")) },
    ]);
    expect(bytes.length).toBeLessThan(MAX_IMPORT_FILE_BYTES);
    expect(() => readXlsxFirstSheet(bytes)).toThrow(genericError);
  });

  it.each([false, true])("rejects an entry larger than 16 MiB (stored=%s)", (stored) => {
    const bytes = buildZip(
      [{ name: "xl/workbook.xml", data: Buffer.alloc(16 * 1024 * 1024 + 1) }],
      { stored },
    );
    expect(() => readXlsxFirstSheet(bytes)).toThrow(genericError);
  });

  it("rejects 41 columns immediately, including sparse out-of-range references", () => {
    expect(() => readXlsxFirstSheet(buildXlsx({ sheets: [[Array(41).fill("value")]] }))).toThrow(
      "El archivo tiene más de 40 columnas.",
    );
    const xml = '<worksheet><sheetData><row><c r="AO1"><v>1</v></c></row><broken';
    expect(() => readXlsxFirstSheet(customSheet(xml))).toThrow(
      "El archivo tiene más de 40 columnas.",
    );
  });

  it("accepts 40 columns and 201 non-empty rows while ignoring empty rows", () => {
    const data = Array.from({ length: 201 }, (_, row) =>
      Array.from({ length: 40 }, (_, column) => `${row}:${column}`),
    );
    data.splice(1, 0, Array(40).fill(""));
    expect(readXlsxFirstSheet(buildXlsx({ sheets: [data] }))).toEqual(data);
  });

  it("stops at 202 non-empty rows before processing the rest of the XML", () => {
    const rows = "<row><c><v>1</v></c></row>".repeat(202);
    expect(() => readXlsxFirstSheet(customSheet(`<worksheet><sheetData>${rows}<broken`))).toThrow(
      "El archivo tiene más de 200 filas.",
    );
  });

  it("uses the reader through readImportFile and preserves limit messages", async () => {
    expect(await readImportFile("responses.XLSX", buildXlsx(singleSheet))).toEqual({
      headers: singleSheet.sheets[0]![0],
      rows: [singleSheet.sheets[0]![1]],
    });
    await expect(
      readImportFile("responses.xlsx", buildXlsx({ sheets: [[Array(41).fill("value")]] })),
    ).rejects.toThrow("El archivo tiene más de 40 columnas.");
  });
});
