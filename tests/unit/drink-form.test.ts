import { describe, expect, it } from "vitest";

import { readDrinkSaveResponse } from "@/ui/admin/drink-form";

describe("drink form response reader", () => {
  it("reads a JSON success", async () => {
    const response = Response.json({ ok: true, message: "Bebida creada.", id: "drink-id" });
    await expect(readDrinkSaveResponse(response)).resolves.toEqual({
      ok: true,
      message: "Bebida creada.",
      id: "drink-id",
    });
  });

  it("reads a JSON error with field errors", async () => {
    const response = Response.json({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { price: "Precio inválido." },
    });
    await expect(readDrinkSaveResponse(response)).resolves.toEqual({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { price: "Precio inválido." },
    });
  });

  it("falls back for a non-JSON body", async () => {
    const response = new Response("Payload Too Large", {
      status: 413,
      headers: { "content-type": "text/html" },
    });
    await expect(readDrinkSaveResponse(response)).resolves.toEqual({
      ok: false,
      message: "No se pudo guardar la bebida.",
    });
  });
});
