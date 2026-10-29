// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DrinkDetailsDialog } from "@/ui/drink-details-dialog";

afterEach(cleanup);

describe("DrinkDetailsDialog", () => {
  it("reveals all drink details and closes with Escape", async () => {
    render(
      <DrinkDetailsDialog
        name="Cóctel de la casa"
        description={"Notas cítricas\nServido frío"}
        price="$12.50"
        imageUrl="/bebidas/imagen/image-1"
        visibility="Visible"
      >
        <button type="button">Cóctel de la casa</button>
      </DrinkDetailsDialog>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cóctel de la casa" }));

    const dialog = await screen.findByRole("dialog", { name: "Cóctel de la casa" });
    expect(dialog.textContent).toContain("Notas cítricas\nServido frío");
    expect(within(dialog).getByText("$12.50")).toBeDefined();
    expect(within(dialog).getByText("Visible")).toBeDefined();
    expect(
      within(dialog).getByRole("img", { name: "Imagen de Cóctel de la casa" }).getAttribute("src"),
    ).toBe("/bebidas/imagen/image-1");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows an empty description and works without image or visibility", async () => {
    render(
      <DrinkDetailsDialog name="Agua" description={null} price="$2.00" imageUrl={null}>
        <button type="button">Agua</button>
      </DrinkDetailsDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Agua" }));
    const dialog = await screen.findByRole("dialog", { name: "Agua" });
    expect(within(dialog).getByText("Sin descripción.")).toBeDefined();
    expect(within(dialog).queryByRole("img")).toBeNull();
    expect(within(dialog).queryByText("Visible")).toBeNull();
  });
});
