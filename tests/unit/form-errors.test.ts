import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";

describe("fieldErrorsFromZod", () => {
  it("keeps the first message per top-level field", () => {
    const result = z
      .object({
        email: z.string().min(1, "El email es obligatorio.").email("El email no es válido."),
        profile: z.object({ name: z.string().min(1, "El nombre es obligatorio.") }),
      })
      .safeParse({ email: "", profile: { name: "" } });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(fieldErrorsFromZod(result.error)).toEqual({
      email: "El email es obligatorio.",
      profile: "El nombre es obligatorio.",
    });
  });
});
