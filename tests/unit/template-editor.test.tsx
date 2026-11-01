// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplateEditor } from "@/ui/admin/messages/template-editor";

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderEditor() {
  return render(
    <TemplateEditor
      templateKey="WAITLISTED"
      title="En la cola"
      timing="Cuando nos escribe"
      initialBody="Hola {nombre}"
      variables={["nombre", "posicion"]}
      updatedLabel="Última edición: 14/11/2026 10:00 por Ana"
      action={vi.fn(async () => ({ ok: true, message: "Guardada." }))}
    />,
  );
}

describe("TemplateEditor", () => {
  it("inserts chips at the cursor and updates preview and counter", () => {
    renderEditor();
    const textarea = screen.getByRole("textbox", {
      name: "Texto de En la cola",
    }) as HTMLTextAreaElement;
    textarea.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole("button", { name: "{posicion}" }));

    expect(textarea.value).toBe("Hola {posicion}{nombre}");
    expect(screen.getByText("Hola 2Ana")).toBeDefined();
    expect(screen.getByText("23/1000")).toBeDefined();
  });

  it("warns about unknown variables and disables saving", () => {
    renderEditor();
    fireEvent.change(screen.getByRole("textbox", { name: "Texto de En la cola" }), {
      target: { value: "Hola {desconocida}" },
    });

    expect(
      screen.getByText("Estas variables no existen para este mensaje: desconocida."),
    ).toBeDefined();
    expect((screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
