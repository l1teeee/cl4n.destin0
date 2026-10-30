import { describe, expect, it } from "vitest";

import { findUnknownVariables, renderMessageTemplate } from "@/domain/messaging/message-template";

describe("message templates", () => {
  it("finds unique variables that are not allowed for the key", () => {
    expect(
      findUnknownVariables("WAITLISTED", "{nombre} {posicion} {pago} {desconocida} {pago}"),
    ).toEqual(["pago", "desconocida"]);
  });

  it("allows key-specific variables", () => {
    expect(findUnknownVariables("ON_LIST", "{nombre}\n{pago}")).toEqual([]);
    expect(findUnknownVariables("LOCATION", "{fecha}\n{ubicacion}")).toEqual([]);
  });

  it("renders every placeholder and normalizes whitespace", () => {
    expect(
      renderMessageTemplate("  Hola, {nombre}.   \n\n\n\n{faltante}\t  \nFin {nombre}  ", {
        nombre: "Ana",
      }),
    ).toBe("Hola, Ana.\n\nFin Ana");
  });
});
