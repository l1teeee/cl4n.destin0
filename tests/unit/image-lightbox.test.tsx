// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MessageImages } from "@/ui/admin/messages/image-lightbox";

afterEach(cleanup);

const sources = ["/img/a", "/img/b", "/img/c"];

function openImage(index: number) {
  fireEvent.click(screen.getByRole("button", { name: `Ampliar imagen ${index} de 3` }));
  return within(screen.getByRole("dialog"));
}

describe("MessageImages lightbox", () => {
  it("renders nothing without images", () => {
    const { container } = render(<MessageImages srcs={[]} username="ana" />);

    expect(container.firstChild).toBeNull();
  });

  it("uses the username in the thumbnail alt text and falls back without one", () => {
    const { rerender } = render(<MessageImages srcs={["/img/a"]} username="ana.perez" />);
    expect(screen.getByAltText("Imagen enviada por ana.perez")).toBeDefined();

    rerender(<MessageImages srcs={["/img/a"]} username={null} />);
    expect(screen.getByAltText("Imagen enviada")).toBeDefined();
  });

  it("opens the clicked image in a dialog with a link to the original", () => {
    render(<MessageImages srcs={sources} username="ana" />);

    const dialog = openImage(2);

    expect(dialog.getByRole("img").getAttribute("src")).toBe("/img/b");
    const original = dialog.getByRole("link", { name: "Abrir original" });
    expect(original.getAttribute("href")).toBe("/img/b");
    expect(original.getAttribute("target")).toBe("_blank");
    expect(original.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("closes with the close button and with Escape", () => {
    render(<MessageImages srcs={sources} username="ana" />);

    openImage(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    openImage(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the empty area around the image is clicked", () => {
    render(<MessageImages srcs={sources} username="ana" />);
    const dialog = openImage(1);

    fireEvent.click(dialog.getByRole("img"));
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves between images with the buttons and the arrow keys", () => {
    render(<MessageImages srcs={sources} username="ana" />);
    const dialog = openImage(1);

    expect(
      (dialog.getByRole("button", { name: "Imagen anterior" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(dialog.getByRole("button", { name: "Imagen siguiente" }));
    expect(dialog.getByRole("img").getAttribute("src")).toBe("/img/b");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(dialog.getByRole("img").getAttribute("src")).toBe("/img/c");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(dialog.getByRole("img").getAttribute("src")).toBe("/img/c");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(dialog.getByRole("img").getAttribute("src")).toBe("/img/b");
  });

  it("hides the navigation buttons for a single image", () => {
    render(<MessageImages srcs={["/img/a"]} username="ana" />);

    fireEvent.click(screen.getByRole("button", { name: "Ampliar imagen 1 de 1" }));

    expect(screen.queryByRole("button", { name: "Imagen siguiente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Imagen anterior" })).toBeNull();
  });
});
