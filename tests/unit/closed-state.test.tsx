// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClosedState } from "@/ui/public/closed-state";

afterEach(cleanup);

describe("ClosedState", () => {
  it.each([
    [
      { state: "SCHEDULED", opensAt: new Date("2026-11-20T18:00:00.000Z") } as const,
      "La próxima experiencia ya tiene fecha. Las solicitudes abren el Viernes 20 de noviembre, 12:00 p. m.",
    ],
    [{ state: "FULL" } as const, "Los cupos para esta experiencia se agotaron."],
    [{ state: "CLOSED" } as const, "Las solicitudes para esta experiencia ya cerraron."],
    [{ state: "DEFAULT" } as const, "Todavía no hay fecha. Cuando la haya, lo sabrás."],
  ])("renders the %s copy", (variant, copy) => {
    render(<ClosedState variant={variant} />);

    expect(screen.getByRole("heading", { name: "EL CLAN ESTÁ CERRADO" })).toBeDefined();
    expect(screen.getByText(copy)).toBeDefined();
  });
});
