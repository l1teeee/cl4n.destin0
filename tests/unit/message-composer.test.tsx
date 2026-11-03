// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { MessageComposer } from "@/ui/admin/messages/message-composer";

const writeText = vi.fn();

const CLOSED_WINDOW_COPY =
  "La ventana de 24 horas está cerrada: lo que envíes saldrá cuando la persona vuelva a escribir. También puedes copiarlo y enviarlo desde Instagram.";

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function result(ok: boolean, message: string): AdminActionState {
  return { ok, message };
}

function renderComposer(props: Partial<ComponentProps<typeof MessageComposer>> = {}) {
  const sendAction = vi.fn().mockResolvedValue(result(true, "Mensaje enviado."));
  render(
    <MessageComposer
      contactId="contact-1"
      windowOpen
      windowClosesAt={new Date("2026-11-03T20:30:00.000Z")}
      username="ana.perez"
      metaFailing={false}
      sendAction={sendAction}
      recordAction={vi.fn().mockResolvedValue(result(true, "Guardado como enviado a mano."))}
      templates={null}
      {...props}
    />,
  );
  return { sendAction };
}

function textbox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Mensaje" }) as HTMLTextAreaElement;
}

function type(text: string) {
  fireEvent.change(textbox(), { target: { value: text } });
}

describe("MessageComposer window copy", () => {
  it("shows no window notice while the window is open", () => {
    renderComposer();

    expect(screen.queryByText(/Puedes escribirle/)).toBeNull();
    expect(screen.queryByText(CLOSED_WINDOW_COPY)).toBeNull();
  });

  it("explains the closed window", () => {
    renderComposer({ windowOpen: false, windowClosesAt: null });

    expect(screen.getByText(CLOSED_WINDOW_COPY)).toBeDefined();
  });
});

describe("MessageComposer text box", () => {
  it("is a required text field limited to 1000 characters", () => {
    renderComposer();

    expect(textbox().name).toBe("text");
    expect(textbox().required).toBe(true);
    expect(textbox().maxLength).toBe(1000);
  });

  it("uses a one-row placeholder box that the field grows by itself", () => {
    renderComposer();

    expect(textbox().rows).toBe(1);
    expect(textbox().placeholder).toBe("Escribe un mensaje…");
  });

  it("shows the character counter only above 80% of the limit", () => {
    renderComposer();
    type("a".repeat(800));
    expect(screen.queryByText("800/1000")).toBeNull();

    type("a".repeat(801));

    expect(screen.getByText("801/1000")).toBeDefined();
  });

  it("cannot be sent while empty or blank", () => {
    renderComposer();
    const send = screen.getByRole("button", { name: "Enviar" });
    expect(send.hasAttribute("disabled")).toBe(true);

    type("   ");
    expect(send.hasAttribute("disabled")).toBe(true);

    type("Hola");
    expect(send.hasAttribute("disabled")).toBe(false);
  });
});

describe("MessageComposer sending", () => {
  it("sends the text to the contact and shows the result", async () => {
    const { sendAction } = renderComposer({ contactId: "contact-9" });
    type("Nos vemos mañana");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect((await screen.findByRole("status")).textContent).toContain("Mensaje enviado.");
    expect(sendAction).toHaveBeenCalledTimes(1);
    const [contactId, previousState, formData] = sendAction.mock.calls[0]!;
    expect(contactId).toBe("contact-9");
    expect(previousState).toEqual({ ok: false, message: "" });
    expect((formData as FormData).get("text")).toBe("Nos vemos mañana");
  });

  it("clears the text box and the counter after a successful send", async () => {
    renderComposer();
    type("Nos vemos mañana");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() => expect(textbox().value).toBe(""));
    expect(screen.queryByText(/\/1000/)).toBeNull();
  });

  it("keeps the text and shows the error when sending fails", async () => {
    const { sendAction } = renderComposer();
    sendAction.mockResolvedValue(result(false, "No se pudo enviar el mensaje."));
    type("Nos vemos mañana");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "No se pudo enviar el mensaje.",
    );
    expect(textbox().value).toBe("Nos vemos mañana");
  });

  it("shows the field error under the text box", async () => {
    const { sendAction } = renderComposer();
    sendAction.mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { text: "El mensaje es demasiado largo." },
    });
    type("Hola");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    const fieldError = await screen.findByText("El mensaje es demasiado largo.");
    expect(textbox().getAttribute("aria-invalid")).toBe("true");
    expect(textbox().getAttribute("aria-describedby")).toBe(fieldError.id);
  });

  it("shows a pending state while the message is being sent", async () => {
    let finish: ((value: AdminActionState) => void) | undefined;
    const { sendAction } = renderComposer();
    sendAction.mockImplementation(
      () =>
        new Promise<AdminActionState>((resolve) => {
          finish = resolve;
        }),
    );
    type("Hola");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    const pending = await screen.findByRole("button", { name: "Enviando" });
    expect(pending.hasAttribute("disabled")).toBe(true);
    expect(textbox().readOnly).toBe(true);

    await act(async () => finish?.(result(true, "Mensaje enviado.")));

    expect((await screen.findByRole("button", { name: "Enviar" })).hasAttribute("disabled")).toBe(
      true,
    );
    expect(textbox().readOnly).toBe(false);
  });
});

describe("MessageComposer keyboard", () => {
  it("sends with Enter", async () => {
    const { sendAction } = renderComposer();
    type("Hola Ana");

    fireEvent.keyDown(textbox(), { key: "Enter" });

    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    expect((sendAction.mock.calls[0]![2] as FormData).get("text")).toBe("Hola Ana");
  });

  it("keeps a new line for Shift+Enter instead of sending", () => {
    const { sendAction } = renderComposer();
    type("Hola Ana");

    fireEvent.keyDown(textbox(), { key: "Enter", shiftKey: true });

    expect(sendAction).not.toHaveBeenCalled();
  });

  it("does not send an empty message with Enter", () => {
    const { sendAction } = renderComposer();

    fireEvent.keyDown(textbox(), { key: "Enter" });

    expect(sendAction).not.toHaveBeenCalled();
  });
});

describe("MessageComposer manual fallbacks", () => {
  it("offers no manual fallbacks while the window is open", () => {
    renderComposer();

    expect(screen.queryByRole("button", { name: "Copiar" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Abrir chat en Instagram" })).toBeNull();
  });

  it("offers copying the text and opening the Instagram chat when the window is closed", async () => {
    renderComposer({ windowOpen: false, windowClosesAt: null });

    type("Hola Ana");
    expect(screen.queryByRole("button", { name: "Copiar" })).toBeNull();
    const chat = screen.getByRole("link", { name: "Enviar por Instagram" });
    expect(chat.getAttribute("href")).toBe("https://ig.me/m/ana.perez");
    expect(chat.getAttribute("target")).toBe("_blank");
    chat.addEventListener("click", (event) => event.preventDefault());
    await act(async () => {
      fireEvent.click(chat);
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith("Hola Ana");
    expect(screen.getByRole("link", { name: "Copiado" })).toBeDefined();
  });

  it("still sends normally when the window is closed", async () => {
    const { sendAction } = renderComposer({ windowOpen: false, windowClosesAt: null });
    type("Cuando puedas, escríbenos");

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    expect((await screen.findByRole("status")).textContent).toContain("Mensaje enviado.");
    expect(sendAction).toHaveBeenCalledTimes(1);
  });

  it("hides the Instagram link when the contact has no username", () => {
    renderComposer({ windowOpen: false, windowClosesAt: null, username: null });

    expect(screen.getByRole("button", { name: "Copiar" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Abrir chat en Instagram" })).toBeNull();
  });
});
