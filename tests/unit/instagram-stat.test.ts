import { describe, expect, it } from "vitest";

import { instagramStatItem } from "@/ui/admin/instagram-stat";

describe("instagramStatItem", () => {
  it("shows the linked username under Sincronizado", () => {
    expect(
      instagramStatItem({ mode: "instagram", connection: { username: "clandestino" } }),
    ).toEqual({ label: "Instagram", value: "Sincronizado", detail: "@clandestino" });
  });

  it("shows Sin sincronizar when no account is linked", () => {
    expect(instagramStatItem({ mode: "instagram", connection: null })).toEqual({
      label: "Instagram",
      value: "Sin sincronizar",
    });
  });

  it("shows Modo de prueba in log mode", () => {
    expect(instagramStatItem({ mode: "log" })).toEqual({
      label: "Instagram",
      value: "Modo de prueba",
    });
  });
});
