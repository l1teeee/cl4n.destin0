import { deflateRawSync } from "node:zlib";

export interface ZipTestEntry {
  name: string;
  data: string | Uint8Array;
  flags?: number;
  method?: number;
  uncompressedSize?: number;
}

interface ZipFaults {
  stored?: boolean;
  encrypted?: boolean;
  method?: number;
  wrongUncompressedSize?: boolean;
  zip64?: boolean;
}

interface XlsxBuilderOptions extends ZipFaults {
  extraEntries?: number | ZipTestEntry[];
  workbookXml?: string;
  relationshipsXml?: string;
  sheetXml?: string[];
  sharedStringsXml?: string;
  omitSharedStrings?: boolean;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]!;
  return (value ^ 0xffffffff) >>> 0;
}

export function buildZip(entries: ZipTestEntry[], faults: ZipFaults = {}): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const flags = entry.flags ?? (faults.encrypted ? 1 : 0x800);
    const method = entry.method ?? faults.method ?? (faults.stored ? 0 : 8);
    const compressed = method === 0 ? data : deflateRawSync(data);
    const size = faults.zip64
      ? 0xffffffff
      : (entry.uncompressedSize ?? data.length + (faults.wrongUncompressedSize ? 1 : 0));
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function reference(column: number, row: number): string {
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
  }
  return `${letters}${row + 1}`;
}

export function buildXlsx(
  input: { sheets: string[][][]; sharedStrings?: boolean; inlineStrings?: boolean },
  options: XlsxBuilderOptions = {},
): Buffer {
  const shared: string[] = [];
  const sharedIndices = new Map<string, number>();
  const useShared = input.sharedStrings ?? !input.inlineStrings;
  const sheetXml = input.sheets.map((rows, sheet) => {
    if (options.sheetXml?.[sheet] !== undefined) return options.sheetXml[sheet]!;
    const body = rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, column) => {
            const r = reference(column, rowIndex);
            if (value === "") return `<c r="${r}"/>`;
            if (/^-?\d+(?:\.\d+)?$/.test(value)) return `<c r="${r}"><v>${value}</v></c>`;
            if (value === "TRUE" || value === "FALSE")
              return `<c r="${r}" t="b"><v>${value === "TRUE" ? 1 : 0}</v></c>`;
            if (useShared) {
              let index = sharedIndices.get(value);
              if (index === undefined) {
                index = shared.length;
                sharedIndices.set(value, index);
                shared.push(value);
              }
              return `<c r="${r}" t="s"><v>${index}</v></c>`;
            }
            if (input.inlineStrings)
              return `<c r="${r}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
            return `<c r="${r}" t="str"><v>${escapeXml(value)}</v></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");
    return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });
  const sheets = input.sheets
    .map(
      (_, index) =>
        `<sheet name="Sheet ${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const relationships = input.sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  const entries: ZipTestEntry[] = [
    {
      name: "[Content_Types].xml",
      data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: "xl/workbook.xml",
      data:
        options.workbookXml ??
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        options.relationshipsXml ??
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`,
    },
    ...sheetXml.map((data, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data })),
  ];
  if (!options.omitSharedStrings && (useShared || options.sharedStringsXml !== undefined)) {
    entries.push({
      name: "xl/sharedStrings.xml",
      data:
        options.sharedStringsXml ??
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join("")}</sst>`,
    });
  }
  if (typeof options.extraEntries === "number") {
    for (let index = 0; index < options.extraEntries; index += 1) {
      entries.push({ name: `extra/${index}.xml`, data: "" });
    }
  } else if (options.extraEntries) entries.push(...options.extraEntries);
  return buildZip(entries, options);
}
