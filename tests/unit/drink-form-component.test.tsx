// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrinkForm } from "@/ui/admin/drink-form";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const prepareImage = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/ui/admin/prepare-image", () => ({ prepareImage }));

const drink = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "Vino de la casa",
  description: "Copa",
  priceCents: 450,
  isVisible: true,
  imageId: "00000000-0000-4000-8000-000000000020",
};

let objectUrlCount = 0;

function previewImage(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img");
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]')!;
}

function pickFile(container: HTMLElement, name: string): File {
  const file = new File(["bytes"], name, { type: "image/png" });
  fireEvent.change(fileInput(container), { target: { files: [file] } });
  return file;
}

function submit(container: HTMLElement): void {
  fireEvent.submit(container.querySelector("form")!);
}

function sentFormData(): FormData {
  return (fetchMock.mock.calls[0]![1] as { body: FormData }).body;
}

beforeEach(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  objectUrlCount = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrlCount}`);
  URL.revokeObjectURL = vi.fn();
  prepareImage.mockResolvedValue(new Blob(["webp"], { type: "image/webp" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DrinkForm image preview", () => {
  it("revokes the previous object URL when another file is picked and on unmount", () => {
    const { container, unmount } = render(<DrinkForm mode="create" />);

    pickFile(container, "first.png");
    expect(previewImage(container)?.getAttribute("src")).toBe("blob:preview-1");

    pickFile(container, "second.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(previewImage(container)?.getAttribute("src")).toBe("blob:preview-2");

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-2");
  });

  it("revokes the object URL and shows the empty state when the picked image is removed", () => {
    const { container } = render(<DrinkForm mode="create" />);
    pickFile(container, "first.png");

    fireEvent.click(screen.getByRole("button", { name: "Quitar imagen" }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
    expect(previewImage(container)).toBeNull();
    expect(screen.getByText("Sin imagen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Elegir imagen" })).toBeTruthy();
  });

  it("shows the stored image when editing and offers to replace it", () => {
    const { container } = render(<DrinkForm mode="edit" drink={drink} />);

    expect(previewImage(container)?.getAttribute("src")).toBe(`/bebidas/imagen/${drink.imageId}`);
    expect(screen.getByRole("button", { name: "Cambiar imagen" })).toBeTruthy();
    expect(fileInput(container).hasAttribute("name")).toBe(false);
  });
});

describe("DrinkForm submit", () => {
  it("sends the prepared image as bebida.webp to the create endpoint", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, message: "Bebida creada." }));
    const { container } = render(<DrinkForm mode="create" />);
    const file = pickFile(container, "first.png");

    submit(container);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(prepareImage).toHaveBeenCalledWith(file);
    expect(fetchMock.mock.calls[0]![0]).toBe("/admin/drinks/save");
    const sentImage = sentFormData().get("image") as File;
    expect(sentImage.name).toBe("bebida.webp");
    expect(sentFormData().has("removeImage")).toBe(false);
  });

  it("asks the update endpoint to remove the stored image", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, message: "Bebida actualizada." }));
    const { container } = render(<DrinkForm mode="edit" drink={drink} />);
    fireEvent.click(screen.getByRole("button", { name: "Quitar imagen" }));

    submit(container);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe(`/admin/drinks/${drink.id}/save`);
    expect(sentFormData().get("removeImage")).toBe("on");
    expect(sentFormData().has("image")).toBe(false);
    expect(prepareImage).not.toHaveBeenCalled();
  });

  it("keeps the button disabled after a successful save so it cannot save twice", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ok: true, message: "Bebida creada." }, { status: 201 }),
    );
    const { container } = render(<DrinkForm mode="create" />);

    submit(container);

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/drinks"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    const button = screen.getByRole("button", { name: "Guardando..." }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows the server message and field errors and re-enables the button after a failure", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          ok: false,
          message: "Revisa los campos marcados.",
          fieldErrors: { price: "El precio debe ser mayor que cero." },
        },
        { status: 400 },
      ),
    );
    const { container } = render(<DrinkForm mode="create" />);

    submit(container);

    await screen.findByText("El precio debe ser mayor que cero.");
    expect(screen.getByRole("alert").textContent).toBe("Revisa los campos marcados.");
    const button = screen.getByRole("button", { name: "Crear bebida" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("stops and reports an unreadable image without calling the server", async () => {
    prepareImage.mockRejectedValue(
      new Error("No se pudo leer la imagen. Usa una foto JPG, PNG o WebP."),
    );
    const { container } = render(<DrinkForm mode="create" />);
    pickFile(container, "broken.png");

    submit(container);

    await screen.findByText("No se pudo leer la imagen. Usa una foto JPG, PNG o WebP.");
    expect(fetchMock).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Crear bebida" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
