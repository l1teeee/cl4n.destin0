import { describe, expect, it } from "vitest";

import {
  MESSAGE_DIRECTIONS,
  MESSAGE_KINDS,
  MESSAGE_SOURCES,
  MESSAGE_STATUSES,
  TEMPLATE_KEYS,
  TEMPLATE_VARIABLES,
} from "@/domain/messaging/message-types";

describe("message types", () => {
  it("exports every persisted message value", () => {
    expect(MESSAGE_DIRECTIONS).toEqual(["OUTBOUND", "INBOUND"]);
    expect(MESSAGE_SOURCES).toEqual(["SYSTEM", "ADMIN", "INSTAGRAM_APP", "GUEST"]);
    expect(MESSAGE_STATUSES).toHaveLength(9);
    expect(MESSAGE_KINDS).toHaveLength(13);
    expect(TEMPLATE_KEYS).toHaveLength(11);
    expect(TEMPLATE_KEYS.at(-1)).toBe("TAB");
  });

  it("assigns template variables by key", () => {
    for (const key of TEMPLATE_KEYS) {
      expect(TEMPLATE_VARIABLES[key]).toEqual(
        expect.arrayContaining(
          key === "TAB" ? ["nombre", "fecha"] : ["nombre", "nombres", "fecha"],
        ),
      );
    }
    expect(TEMPLATE_VARIABLES.WAITLISTED).toContain("posicion");
    expect(TEMPLATE_VARIABLES.ON_LIST).toContain("pago");
    expect(TEMPLATE_VARIABLES.LOCATION).toContain("ubicacion");
    expect(TEMPLATE_VARIABLES.PAID).not.toContain("pago");
    expect(TEMPLATE_VARIABLES.TAB).toEqual([
      "nombre",
      "fecha",
      "consumos",
      "total",
      "banco",
      "tipo_cuenta",
      "cuenta",
      "titular",
      "enlace_pago",
      "datos_pago",
    ]);
  });
});
