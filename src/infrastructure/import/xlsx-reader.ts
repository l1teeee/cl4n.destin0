import { inflateRawSync } from "node:zlib";

import { MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "@/contracts/guest-import";
import { ImportTableError } from "@/domain/guest-import/import-rows";

const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 32 * 1024 * 1024;
const ZIP64_MARKER = 0xffffffff;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

function invalidFile(): never {
  throw new ImportTableError("No se pudo leer el archivo.");
}

function readDirectory(bytes: Buffer): { entries: Map<string, ZipEntry>; offset: number } {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end === -1) invalidFile();
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (
    count > 2_000 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    size === ZIP64_MARKER ||
    directoryOffset === ZIP64_MARKER ||
    directoryOffset + size > end
  ) {
    invalidFile();
  }
  const entries = new Map<string, ZipEntry>();
  let offset = directoryOffset;
  const directoryEnd = offset + size;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) invalidFile();
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next =
      offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > directoryEnd) invalidFile();
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    const entry: ZipEntry = {
      name,
      flags: bytes.readUInt16LE(offset + 8),
      method: bytes.readUInt16LE(offset + 10),
      compressedSize: bytes.readUInt32LE(offset + 20),
      size: bytes.readUInt32LE(offset + 24),
      offset: bytes.readUInt32LE(offset + 42),
    };
    if (
      (entry.flags & 1) !== 0 ||
      entry.compressedSize === ZIP64_MARKER ||
      entry.size === ZIP64_MARKER ||
      entry.offset === ZIP64_MARKER ||
      entry.offset + 30 > directoryOffset ||
      bytes.readUInt16LE(offset + 34) !== 0 ||
      entries.has(name)
    ) {
      invalidFile();
    }
    entries.set(name, entry);
    offset = next;
  }
  if (offset !== directoryEnd) invalidFile();
  return { entries, offset: directoryOffset };
}

function createXmlReader(bytes: Buffer): (name: string, optional?: boolean) => string | null {
  const directory = readDirectory(bytes);
  let extractedBytes = 0;
  return (name, optional = false) => {
    const entry = directory.entries.get(name);
    if (!entry) {
      if (optional) return null;
      invalidFile();
    }
    if (
      (entry.method !== 0 && entry.method !== 8) ||
      entry.size > MAX_ENTRY_BYTES ||
      extractedBytes + entry.size > MAX_EXTRACTED_BYTES ||
      bytes.readUInt32LE(entry.offset) !== 0x04034b50 ||
      bytes.readUInt16LE(entry.offset + 6) !== entry.flags ||
      bytes.readUInt16LE(entry.offset + 8) !== entry.method ||
      bytes.readUInt32LE(entry.offset + 18) === ZIP64_MARKER ||
      bytes.readUInt32LE(entry.offset + 22) === ZIP64_MARKER
    ) {
      invalidFile();
    }
    const nameLength = bytes.readUInt16LE(entry.offset + 26);
    const dataOffset = entry.offset + 30 + nameLength + bytes.readUInt16LE(entry.offset + 28);
    if (dataOffset + entry.compressedSize > directory.offset) invalidFile();
    const localName = bytes
      .subarray(entry.offset + 30, entry.offset + 30 + nameLength)
      .toString("utf8");
    if (localName !== name) invalidFile();
    const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    const data =
      entry.method === 8
        ? inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES })
        : compressed;
    if (data.length !== entry.size) invalidFile();
    extractedBytes += data.length;
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) invalidFile();
    return xml;
  };
}

function unescapeXml(text: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(
    /&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);|&/g,
    (_, entity: string | undefined) => {
      if (!entity) invalidFile();
      if (entity[0] !== "#") return entities[entity]!;
      const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (
        ![9, 10, 13].includes(code) &&
        !(code >= 0x20 && code <= 0xd7ff) &&
        !(code >= 0xe000 && code <= 0xfffd) &&
        !(code >= 0x10000 && code <= 0x10ffff)
      ) {
        invalidFile();
      }
      return String.fromCodePoint(code);
    },
  );
}

type XmlToken =
  | { kind: "open"; name: string; attributes: Record<string, string> }
  | { kind: "close"; name: string }
  | { kind: "text"; value: string };

function localName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

function readAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null);
  const pattern = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
  let offset = 0;
  const end = text.trimEnd().length;
  while (offset < end) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match || Object.hasOwn(attributes, match[1]!)) invalidFile();
    attributes[match[1]!] = unescapeXml(match[2] ?? match[3]!);
    offset = pattern.lastIndex;
  }
  return attributes;
}

function* xmlTokens(xml: string, root: string): Generator<XmlToken> {
  const stack: string[] = [];
  let rootSeen = false;
  let offset = 0;
  while (offset < xml.length) {
    if (xml[offset] !== "<") {
      const next = xml.indexOf("<", offset);
      const end = next === -1 ? xml.length : next;
      const value = unescapeXml(xml.slice(offset, end));
      if (!stack.length && value.trim()) invalidFile();
      if (stack.length) yield { kind: "text", value };
      offset = end;
      continue;
    }
    if (xml.startsWith("<!--", offset) || xml.startsWith("<?", offset)) {
      const comment = xml.startsWith("<!--", offset);
      const end = xml.indexOf(comment ? "-->" : "?>", offset + (comment ? 4 : 2));
      if (end === -1) invalidFile();
      offset = end + (comment ? 3 : 2);
      continue;
    }
    if (xml.startsWith("<![CDATA[", offset)) {
      const end = xml.indexOf("]]>", offset + 9);
      if (end === -1 || !stack.length) invalidFile();
      yield { kind: "text", value: xml.slice(offset + 9, end) };
      offset = end + 3;
      continue;
    }
    let end = offset + 1;
    let quote = "";
    for (; end < xml.length; end += 1) {
      const character = xml[end]!;
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
      else if (character === "<") invalidFile();
    }
    if (end === xml.length) invalidFile();
    const body = xml.slice(offset + 1, end);
    const closing = /^\/([A-Za-z_][\w.:-]*)\s*$/.exec(body);
    if (closing) {
      if (stack.pop() !== closing[1]) invalidFile();
      yield { kind: "close", name: localName(closing[1]!) };
    } else {
      const selfClosing = body.endsWith("/");
      const opening = /^([A-Za-z_][\w.:-]*)([\s\S]*)$/.exec(selfClosing ? body.slice(0, -1) : body);
      if (!opening) invalidFile();
      const name = opening[1]!;
      if (!stack.length) {
        if (rootSeen || localName(name) !== root) invalidFile();
        rootSeen = true;
      }
      const attributes = readAttributes(opening[2]!);
      stack.push(name);
      yield { kind: "open", name: localName(name), attributes };
      if (selfClosing) {
        stack.pop();
        yield { kind: "close", name: localName(name) };
      }
    }
    offset = end + 1;
  }
  if (!rootSeen || stack.length) invalidFile();
}

function firstSheetPath(workbook: string, relationships: string): string {
  let firstSheetSeen = false;
  let relationshipId: string | null = null;
  for (const token of xmlTokens(workbook, "workbook")) {
    if (token.kind === "open" && token.name === "sheet" && !firstSheetSeen) {
      firstSheetSeen = true;
      relationshipId = token.attributes["r:id"] ?? null;
    }
  }
  let target: string | null = null;
  for (const token of xmlTokens(relationships, "Relationships")) {
    if (
      token.kind === "open" &&
      token.name === "Relationship" &&
      token.attributes.Id === relationshipId
    ) {
      if (target !== null || token.attributes.TargetMode === "External") invalidFile();
      target = token.attributes.Target ?? null;
      if (!target) invalidFile();
    }
  }
  if (!relationshipId) return "xl/worksheets/sheet1.xml";
  if (!target || /[:\\?#]/.test(target)) invalidFile();
  const parts = target.startsWith("/") ? [] : ["xl"];
  for (const part of target.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) invalidFile();
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let item: string | null = null;
  let inText = false;
  for (const token of xmlTokens(xml, "sst")) {
    if (token.kind === "open") {
      if (token.name === "si") item = "";
      if (token.name === "t" && item !== null) inText = true;
    } else if (token.kind === "text") {
      if (inText) item += token.value;
    } else {
      if (token.name === "t") inText = false;
      if (token.name === "si") {
        strings.push(item!);
        item = null;
      }
    }
  }
  return strings;
}

interface SheetCell {
  column: number;
  type: string;
  value: string;
  text: string;
}

function cellValue(cell: SheetCell, sharedStrings: string[]): string {
  if (cell.type === "s") {
    if (!/^\d+$/.test(cell.value.trim())) invalidFile();
    const value = sharedStrings[Number(cell.value)];
    if (value === undefined) invalidFile();
    return value;
  }
  if (cell.type === "inlineStr") return cell.text;
  if (cell.type === "e") return "";
  if (cell.type === "b") {
    if (cell.value.trim() === "1") return "TRUE";
    if (cell.value.trim() === "0") return "FALSE";
    invalidFile();
  }
  return cell.value;
}

function columnIndex(reference: string | undefined, next: number): number {
  let column = next;
  if (reference !== undefined) {
    const match = /^([A-Za-z]+)[1-9]\d*$/.exec(reference);
    if (!match) invalidFile();
    column = 0;
    for (const letter of match[1]!.toUpperCase()) {
      column = column * 26 + letter.charCodeAt(0) - 64;
      if (column > MAX_IMPORT_COLUMNS) break;
    }
    column -= 1;
  }
  if (column >= MAX_IMPORT_COLUMNS) {
    throw new ImportTableError("El archivo tiene más de 40 columnas.");
  }
  if (column < next) invalidFile();
  return column;
}

function readSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows = new Map<number, string[]>();
  let rowNumber = 0;
  let row: string[] | null = null;
  let cell: SheetCell | null = null;
  let inValue = false;
  let inInline = false;
  let inText = false;
  let width = 0;
  let lastNonEmptyRow = 0;
  for (const token of xmlTokens(xml, "worksheet")) {
    if (token.kind === "open") {
      if (token.name === "row") {
        if (row !== null) invalidFile();
        const reference = token.attributes.r;
        const next = reference === undefined ? rowNumber + 1 : Number(reference);
        if (!Number.isInteger(next) || next <= rowNumber || next > 1_048_576) invalidFile();
        rowNumber = next;
        row = [];
      } else if (token.name === "c") {
        if (!row || cell) invalidFile();
        const column = columnIndex(token.attributes.r, row.length);
        width = Math.max(width, column + 1);
        cell = { column, type: token.attributes.t ?? "", value: "", text: "" };
      } else if (cell) {
        if (token.name === "v") inValue = true;
        if (token.name === "is") inInline = true;
        if (token.name === "t" && inInline) inText = true;
      }
    } else if (token.kind === "text") {
      if (cell && inValue) cell.value += token.value;
      if (cell && inText) cell.text += token.value;
    } else {
      if (token.name === "v") inValue = false;
      if (token.name === "t") inText = false;
      if (token.name === "is") inInline = false;
      if (token.name === "c") {
        if (!row || !cell) invalidFile();
        row[cell.column] = cellValue(cell, sharedStrings);
        cell = null;
      }
      if (token.name === "row") {
        if (!row || cell) invalidFile();
        if (row.some((value) => value.trim() !== "")) {
          rows.set(rowNumber, row);
          lastNonEmptyRow = rowNumber;
          if (rows.size > MAX_IMPORT_ROWS + 1) {
            throw new ImportTableError("El archivo tiene más de 200 filas.");
          }
        }
        row = null;
      }
    }
  }
  // Missing rows can share their empty cells without expanding a sparse sheet into millions of cells.
  const emptyRow = Array<string>(width).fill("");
  return Array.from({ length: lastNonEmptyRow }, (_, index) => {
    const values = rows.get(index + 1);
    return values ? Array.from({ length: width }, (_, column) => values[column] ?? "") : emptyRow;
  });
}

export function readXlsxFirstSheet(bytes: Uint8Array): string[][] {
  try {
    const readXml = createXmlReader(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const workbook = readXml("xl/workbook.xml")!;
    const relationships = readXml("xl/_rels/workbook.xml.rels")!;
    const path = firstSheetPath(workbook, relationships);
    const shared = readXml("xl/sharedStrings.xml", true);
    const strings = shared === null ? [] : readSharedStrings(shared);
    return readSheetRows(readXml(path)!, strings);
  } catch (error) {
    if (error instanceof ImportTableError) throw error;
    invalidFile();
  }
}
