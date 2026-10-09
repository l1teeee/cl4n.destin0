import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

describe("drizzle migration journal", () => {
  it("lists entries in idx order starting at 0", () => {
    journal.entries.forEach((entry, position) => {
      expect(entry.idx).toBe(position);
    });
  });

  // The migrator skips a migration whose `when` is not greater than the last applied one.
  it("has strictly increasing when values", () => {
    for (let position = 1; position < journal.entries.length; position += 1) {
      const previous = journal.entries[position - 1]!;
      const current = journal.entries[position]!;
      expect(current.when, `${current.tag} must be after ${previous.tag}`).toBeGreaterThan(
        previous.when,
      );
    }
  });
});
