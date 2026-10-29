import { describe, expect, it } from "vitest";

import { eventClueSchema } from "@/contracts/event-clue";

describe("eventClueSchema", () => {
  it.each(["", "   \n  "])("rejects an empty body: %j", (body) => {
    const result = eventClueSchema.safeParse({ body });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Escribe la pista.");
  });

  it("accepts 500 characters and rejects 501", () => {
    expect(eventClueSchema.safeParse({ body: "a".repeat(500) }).success).toBe(true);
    const result = eventClueSchema.safeParse({ body: "a".repeat(501) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("La pista no puede superar 500 caracteres.");
    }
  });

  it("trims the body", () => {
    expect(eventClueSchema.parse({ body: "  Busca bajo la mesa. \n" })).toEqual({
      body: "Busca bajo la mesa.",
    });
  });
});
