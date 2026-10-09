// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicLinkPanel } from "@/ui/admin/public-link-panel";

const url = "https://clandestino.example/solicitar/cena";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("PublicLinkPanel", () => {
  it("starts with only the generate button and no URL input", () => {
    mockClipboard();
    render(<PublicLinkPanel url={url} hint={null} />);

    expect(screen.getByRole("button", { name: "Generar link para público" })).toBeDefined();
    expect(screen.queryByDisplayValue(url)).toBeNull();
  });

  it("reveals and copies the public URL", async () => {
    const writeText = mockClipboard();
    render(<PublicLinkPanel url={url} hint={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Generar link para público" }));

    expect(
      (screen.getByRole("textbox", { name: "Enlace público" }) as HTMLInputElement).value,
    ).toBe(url);
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith(url);
    expect(screen.getByRole("status").textContent).toBe("Enlace copiado.");
  });

  it("keeps the URL visible when copying fails", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<PublicLinkPanel url={url} hint={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Generar link para público" }));

    expect(
      (screen.getByRole("textbox", { name: "Enlace público" }) as HTMLInputElement).value,
    ).toBe(url);
    expect((await screen.findByRole("status")).textContent).toBe(
      "No se pudo copiar. Selecciona el enlace y cópialo manualmente.",
    );
  });

  it("renders a provided hint and omits a null hint", () => {
    mockClipboard();
    const hint = "El enlace mostrará el formulario cerrado hasta que abra.";
    const first = render(<PublicLinkPanel url={url} hint={hint} />);

    expect(screen.getByText(hint)).toBeDefined();
    first.unmount();

    render(<PublicLinkPanel url={url} hint={null} />);
    expect(screen.queryByText(hint)).toBeNull();
  });

  it("copies the revealed URL again", async () => {
    const writeText = mockClipboard();
    render(<PublicLinkPanel url={url} hint={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Generar link para público" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Copiar enlace" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith(url);
  });
});
