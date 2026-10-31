import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const scannedDirectories = ["src", "tests", "docs", "drizzle", "scripts"];
const scannedExtensions = [".ts", ".tsx", ".css", ".md", ".sql"];
const skippedDirectories = [path.join(repositoryRoot, "drizzle", "meta")];

interface CorruptedSequence {
  name: string;
  sequence: string;
}

// Built from char codes so this file never contains the corruption it searches for.
// Invalid UTF-8 bytes also decode to U+FFFD, so they are caught by the first entry.
const replacementCharacters: CorruptedSequence[] = [
  { name: "U+FFFD replacement character", sequence: String.fromCharCode(0xfffd) },
  { name: "U+01ED, which replaced an a with acute accent", sequence: String.fromCharCode(0x01ed) },
];

// A double-encoded character is its UTF-8 bytes read as Latin-1.
const doubleEncodedSequences: CorruptedSequence[] = ["á", "é", "í", "ó", "ú", "ñ", "¿", "¡"].map(
  (character) => ({
    name: `double-encoded ${character}`,
    sequence: Buffer.from(character, "utf8").toString("latin1"),
  }),
);

const corruptedSequences = [...replacementCharacters, ...doubleEncodedSequences];

interface Corruption {
  line: number;
  name: string;
}

function sourceFilesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const skipped = entry.name === "node_modules" || skippedDirectories.includes(entryPath);
      return skipped ? [] : sourceFilesIn(entryPath);
    }
    return scannedExtensions.includes(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function findCorruption(text: string): Corruption[] {
  const corruptions: Corruption[] = [];
  text.split("\n").forEach((lineText, index) => {
    for (const { name, sequence } of corruptedSequences) {
      if (lineText.includes(sequence)) corruptions.push({ line: index + 1, name });
    }
  });
  return corruptions;
}

function relativePath(file: string): string {
  return path.relative(repositoryRoot, file).split(path.sep).join("/");
}

describe("source encoding", () => {
  const files = scannedDirectories.flatMap((directory) =>
    sourceFilesIn(path.join(repositoryRoot, directory)),
  );

  it("scans the source tree, including this file", () => {
    expect(files.map(relativePath)).toContain("tests/unit/source-encoding.test.ts");
  });

  it("finds no replacement characters or double-encoded accents in any source file", () => {
    const violations = files.flatMap((file) =>
      findCorruption(readFileSync(file, "utf8")).map(
        ({ line, name }) => `${relativePath(file)}:${line} contains ${name}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it.each(corruptedSequences)("detects $name and reports its line", ({ name, sequence }) => {
    expect(findCorruption(`clean line\nbroken ${sequence} line`)).toEqual([{ line: 2, name }]);
  });

  it("does not flag correctly encoded Spanish", () => {
    expect(findCorruption("sesión válida, ¿lista? ¡sí! mañana, café y último")).toEqual([]);
  });
});
