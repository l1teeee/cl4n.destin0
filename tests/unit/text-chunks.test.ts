import { describe, expect, it } from "vitest";

import { splitIntoChunks } from "@/domain/messaging/text-chunks";

describe("text chunks", () => {
  it("keeps exact-limit text in one chunk", () => {
    expect(splitIntoChunks("a".repeat(1000))).toEqual(["a".repeat(1000)]);
  });

  it("splits accents and emoji without breaking UTF-8 characters", () => {
    const chunks = splitIntoChunks("á".repeat(4) + " 😀 " + "é".repeat(4), 10);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, "utf8") <= 10)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe("áááá 😀 éééé");
  });

  it("uses the last whitespace before the byte limit", () => {
    expect(splitIntoChunks("hello kind world", 10)).toEqual(["hello", "kind world"]);
  });

  it("hard-cuts a word longer than the limit", () => {
    expect(splitIntoChunks("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
  });

  it("does not emit empty chunks", () => {
    expect(splitIntoChunks("   hello   world   ", 6)).toEqual(["hello", "world"]);
  });
});
