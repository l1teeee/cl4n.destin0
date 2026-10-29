// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, prepareImage } = vi.hoisted(() => ({ refresh: vi.fn(), prepareImage: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/ui/admin/prepare-image", () => ({ prepareImage }));

import { EventClueComposer } from "@/ui/admin/event-clue-composer";

beforeEach(() => {
  refresh.mockReset();
  prepareImage.mockReset();
  prepareImage.mockResolvedValue(new Blob(["image"], { type: "image/webp" }));
  URL.createObjectURL = vi.fn(() => "blob:clue-preview");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EventClueComposer", () => {
  it("compresses and previews selected images before publishing multipart data", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "clue-id" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    render(<EventClueComposer eventId="event-1" />);

    const file = new File(["large source"], "photo.jpg", { type: "image/jpeg" });
    const fileInput = screen.getByLabelText(/Imágenes/) as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(fileInput.value).toBe("");
    expect(await screen.findByAltText("Vista previa de imagen 1")).toBeDefined();
    expect(prepareImage).toHaveBeenCalledWith(file);

    fireEvent.change(screen.getByRole("textbox", { name: "Pista" }), {
      target: { value: "Busca la puerta azul" },
    });
    const draftPreview = screen.getByRole("region", { name: "Vista previa de la pista" });
    expect(draftPreview.textContent).toContain("Busca la puerta azul");
    expect(draftPreview.querySelectorAll("img")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Generar pista" }));
    expect(screen.getByRole("textbox", { name: "Pista" }).hasAttribute("disabled")).toBe(true);
    expect(fileInput.hasAttribute("disabled")).toBe(true);

    await screen.findByRole("status");
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/admin/events/event-1/clues");
    expect(options?.method).toBe("POST");
    expect(options?.credentials).toBe("same-origin");
    const formData = options?.body as FormData;
    expect(formData.get("body")).toBe("Busca la puerta azul");
    expect(formData.getAll("images")).toHaveLength(1);
    expect((formData.get("images") as File).type).toBe("image/webp");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clue-preview");
  });

  it("shows a clear error when the API rejects a clue", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Las pistas solo se pueden publicar mientras está cerrada." }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    render(<EventClueComposer eventId="event-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Pista" }), {
      target: { value: "Pista de prueba" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generar pista" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Las pistas solo se pueden publicar",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
