// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import {
  messageStatuses,
  type MessageStatus,
  type ThreadMessageView,
} from "@/ui/admin/messages/message-copy";
import { MessageThread } from "@/ui/admin/messages/message-thread";

const scrollIntoView = vi.fn();
const writeText = vi.fn();

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

beforeEach(() => {
  scrollIntoView.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function done(message: string): AdminActionState {
  return { ok: true, message };
}

function message(overrides: Partial<ThreadMessageView> = {}): ThreadMessageView {
  return {
    id: "message-1",
    direction: "OUTBOUND",
    kind: "FREE_TEXT",
    status: "SENT",
    source: "ADMIN",
    body: "Hola, ya estás en la lista.",
    imageSrcs: [],
    timeLabel: "10:30",
    lastError: null,
    ...overrides,
  };
}

function createActions() {
  return {
    retryAction: vi.fn().mockResolvedValue(done("Reintentando.")),
    markSentAction: vi.fn().mockResolvedValue(done("Marcado como enviado.")),
    discardAction: vi.fn().mockResolvedValue(done("Descartado.")),
  };
}

function renderThread(props: Partial<ComponentProps<typeof MessageThread>> = {}) {
  const actions = createActions();
  const view = render(
    <MessageThread
      messages={[message()]}
      username="ana.perez"
      canAct={true}
      {...actions}
      {...props}
    />,
  );
  return { ...view, actions };
}

function bubbleOf(text: string): HTMLElement {
  return screen.getByText(text).closest("li") as HTMLElement;
}

describe("MessageThread empty state", () => {
  it("says there are no messages yet", () => {
    renderThread({ messages: [] });

    expect(screen.getByText("Todavía no hay mensajes.")).toBeDefined();
    expect(screen.queryByRole("list", { name: "Mensajes" })).toBeNull();
  });
});

describe("MessageThread bubbles", () => {
  it("keeps the given order and puts inbound on the left and outbound on the right", () => {
    renderThread({
      messages: [
        message({
          id: "m1",
          direction: "INBOUND",
          kind: "INBOUND",
          status: "RECEIVED",
          body: "Primero",
        }),
        message({ id: "m2", body: "Segundo" }),
        message({
          id: "m3",
          direction: "INBOUND",
          kind: "INBOUND",
          status: "RECEIVED",
          body: "Tercero",
        }),
      ],
    });

    const bubbles = Array.from(screen.getByRole("list", { name: "Mensajes" }).children);
    expect(bubbles.map((bubble) => bubble.textContent)).toEqual([
      expect.stringContaining("Primero"),
      expect.stringContaining("Segundo"),
      expect.stringContaining("Tercero"),
    ]);
    expect(bubbles[0]!.className).toContain("justify-start");
    expect(bubbles[1]!.className).toContain("justify-end");
    expect(bubbles[2]!.className).toContain("justify-start");
  });

  it("shows the kind label, the status badge and the time on outbound messages", () => {
    renderThread({
      messages: [
        message({ kind: "CLUE", status: "READ", body: "Busca la puerta azul", timeLabel: "21:05" }),
      ],
    });

    const bubble = bubbleOf("Busca la puerta azul");
    expect(within(bubble).getByText("Pista").className).not.toContain("sr-only");
    expect(within(bubble).getByText("Leído")).toBeDefined();
    expect(within(bubble).getByText("21:05")).toBeDefined();
  });

  it("shows only the time on inbound messages and keeps their kind for screen readers", () => {
    renderThread({
      messages: [
        message({
          direction: "INBOUND",
          kind: "INBOUND",
          status: "RECEIVED",
          source: "GUEST",
          body: "¿A qué hora es?",
          timeLabel: "10:42",
        }),
      ],
    });

    const bubble = bubbleOf("¿A qué hora es?");
    expect(within(bubble).getByText("10:42")).toBeDefined();
    expect(within(bubble).queryByText("Recibido")).toBeNull();
    expect(within(bubble).getByText("Mensaje recibido").className).toContain("sr-only");
    expect(within(bubble).queryByRole("button")).toBeNull();
  });

  it("keeps line breaks in the text", () => {
    renderThread({ messages: [message({ body: "Primera línea\nSegunda línea" })] });

    const text = screen.getByText(
      (_, element) => element?.textContent === "Primera línea\nSegunda línea",
    );
    expect(text.tagName).toBe("P");
    expect(text.className).toContain("whitespace-pre-line");
  });

  it("marks messages sent from the Instagram app", () => {
    renderThread({
      messages: [
        message({ id: "m1", source: "INSTAGRAM_APP", body: "Desde el celular" }),
        message({ id: "m2", source: "ADMIN", body: "Desde el panel" }),
      ],
    });

    expect(within(bubbleOf("Desde el celular")).getByText("Desde Instagram")).toBeDefined();
    expect(within(bubbleOf("Desde el panel")).queryByText("Desde Instagram")).toBeNull();
  });

  it("renders images as thumbnails that open the lightbox instead of a new tab", () => {
    renderThread({
      messages: [
        message({
          body: "Mira",
          imageSrcs: ["/admin/messages/images/a", "/admin/messages/images/b"],
        }),
      ],
    });

    const first = screen.getByRole("button", { name: "Ampliar imagen 1 de 2" });
    expect(screen.queryByRole("link", { name: /Imagen/ })).toBeNull();
    expect(within(first).getByRole("img").getAttribute("src")).toBe("/admin/messages/images/a");
    expect(screen.getByRole("button", { name: "Ampliar imagen 2 de 2" })).toBeDefined();
  });

  it("renders no image list and no text paragraph when the message has neither", () => {
    renderThread({ messages: [message({ body: null, imageSrcs: [] })] });

    expect(screen.queryByRole("list", { name: "Imágenes del mensaje" })).toBeNull();
    expect(screen.queryByText("Hola, ya estás en la lista.")).toBeNull();
  });
});

describe("MessageThread status labels", () => {
  it.each([
    ["WAITING_CONTACT", "Pendiente: aún no nos escribe"],
    ["WAITING_WINDOW", "Pendiente: ventana cerrada"],
    ["QUEUED", "Enviando"],
    ["SENT", "Enviado"],
    ["READ", "Leído"],
    ["FAILED", "No se pudo enviar"],
    ["SENT_MANUALLY", "Enviado a mano"],
    ["DISCARDED", "Descartado"],
  ] as const)("labels an outbound %s message", (status, label) => {
    renderThread({ messages: [message({ status, body: "Texto del mensaje" })] });

    expect(within(bubbleOf("Texto del mensaje")).getByText(label)).toBeDefined();
  });
});

describe("MessageThread manual actions per status", () => {
  const withManualActions: ReadonlySet<MessageStatus> = new Set([
    "WAITING_CONTACT",
    "WAITING_WINDOW",
    "FAILED",
  ]);
  const withRetry: ReadonlySet<MessageStatus> = new Set(["WAITING_WINDOW", "FAILED"]);

  it.each(messageStatuses)("offers the right buttons for an outbound %s message", (status) => {
    renderThread({ messages: [message({ status, body: "Texto del mensaje" })] });

    const bubble = bubbleOf("Texto del mensaje");
    const has = (role: "button" | "link", name: string) =>
      within(bubble).queryByRole(role, { name }) !== null;

    expect(has("button", "Copiar texto")).toBe(withManualActions.has(status));
    expect(has("link", "Abrir chat en Instagram")).toBe(withManualActions.has(status));
    expect(has("button", "Ya lo envié")).toBe(withManualActions.has(status));
    expect(has("button", "Descartar")).toBe(withManualActions.has(status));
    expect(has("button", "Reintentar")).toBe(withRetry.has(status));
  });

  it("never offers manual actions on inbound messages", () => {
    renderThread({
      messages: [
        message({
          direction: "INBOUND",
          kind: "INBOUND",
          status: "FAILED",
          body: "Texto recibido",
        }),
      ],
    });

    expect(within(bubbleOf("Texto recibido")).queryByRole("button")).toBeNull();
  });

  it("hides the copy button when there is no text but keeps the other actions", () => {
    renderThread({
      messages: [message({ status: "WAITING_WINDOW", body: null, imageSrcs: ["/img/a"] })],
    });

    expect(screen.queryByRole("button", { name: "Copiar texto" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ya lo envié" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeDefined();
  });

  it("hides the Instagram link when the contact has no username", () => {
    renderThread({ messages: [message({ status: "FAILED" })], username: null });

    expect(screen.queryByRole("link", { name: "Abrir chat en Instagram" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copiar texto" })).toBeDefined();
  });

  it("opens the Instagram chat of the contact in a new tab", () => {
    renderThread({ messages: [message({ status: "WAITING_CONTACT" })] });

    const link = screen.getByRole("link", { name: "Abrir chat en Instagram" });
    expect(link.getAttribute("href")).toBe("https://ig.me/m/ana.perez");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("shows the last error only on failed messages", () => {
    renderThread({
      messages: [
        message({
          id: "m1",
          status: "FAILED",
          body: "Falló",
          lastError: "Instagram rechazó el mensaje",
        }),
        message({ id: "m2", status: "SENT", body: "Salió", lastError: "Error viejo" }),
      ],
    });

    const error = within(bubbleOf("Falló")).getByText("Instagram rechazó el mensaje");
    expect(error.className).toContain("text-destructive");
    expect(error.className).toContain("text-xs");
    expect(screen.queryByText("Error viejo")).toBeNull();
  });
});

describe("MessageThread copy feedback", () => {
  it("copies the text and shows Copiado for two seconds", async () => {
    vi.useFakeTimers();
    renderThread({ messages: [message({ status: "FAILED", body: "Hola Ana" })] });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar texto" }));
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith("Hola Ana");
    expect(screen.getByRole("button", { name: "Copiado" })).toBeDefined();

    act(() => vi.advanceTimersByTime(2_000));

    expect(screen.getByRole("button", { name: "Copiar texto" })).toBeDefined();
  });
});

describe("MessageThread server actions", () => {
  it("retries the failed message", async () => {
    const { actions } = renderThread({ messages: [message({ id: "m-retry", status: "FAILED" })] });

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect((await screen.findByRole("status")).textContent).toContain("Reintentando.");
    expect(actions.retryAction).toHaveBeenCalledExactlyOnceWith(
      "m-retry",
      { ok: false, message: "" },
      expect.any(FormData),
    );
    expect(actions.markSentAction).not.toHaveBeenCalled();
    expect(actions.discardAction).not.toHaveBeenCalled();
  });

  it("marks the message as sent by hand", async () => {
    const { actions } = renderThread({
      messages: [message({ id: "m-sent", status: "WAITING_CONTACT" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Ya lo envié" }));

    expect((await screen.findByRole("status")).textContent).toContain("Marcado como enviado.");
    expect(actions.markSentAction).toHaveBeenCalledExactlyOnceWith(
      "m-sent",
      { ok: false, message: "" },
      expect.any(FormData),
    );
  });

  it("asks for confirmation before discarding", async () => {
    const { actions } = renderThread({
      messages: [message({ id: "m-discard", status: "WAITING_WINDOW" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(
      screen.getByText("El mensaje no se enviará a la persona. Confirma para continuar."),
    ).toBeDefined();
    expect(actions.discardAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));

    await waitFor(() => expect(actions.discardAction).toHaveBeenCalledTimes(1));
    expect(actions.discardAction).toHaveBeenCalledWith(
      "m-discard",
      { ok: false, message: "" },
      expect.any(FormData),
    );
  });

  it("does not discard when the confirmation is cancelled", async () => {
    const { actions } = renderThread({ messages: [message({ status: "FAILED" })] });

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(actions.discardAction).not.toHaveBeenCalled();
  });

  it("shows the error when an action fails and keeps the buttons", async () => {
    const actions = createActions();
    actions.markSentAction.mockResolvedValue({ ok: false, message: "No se pudo actualizar." });
    render(
      <MessageThread
        messages={[message({ status: "FAILED" })]}
        username="ana.perez"
        canAct={true}
        {...actions}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ya lo envié" }));

    expect((await screen.findByRole("status")).textContent).toContain("No se pudo actualizar.");
    expect(screen.getByRole("button", { name: "Ya lo envié" })).toBeDefined();
  });

  it("renders no retry, mark-sent or discard controls when canAct is false", () => {
    renderThread({
      canAct: false,
      messages: [message({ status: "FAILED", body: "Pendiente de envío" })],
    });

    expect(screen.getByText("Pendiente de envío")).toBeDefined();
    expect(screen.getByText("No se pudo enviar")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ya lo envié" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copiar texto" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Abrir chat en Instagram" })).toBeNull();
  });
});

describe("MessageThread scrolling", () => {
  function messagesEnding(id: string) {
    return [message({ id: "older" }), message({ id })];
  }

  it("scrolls to the newest message on mount", () => {
    const { container } = renderThread({ messages: messagesEnding("newest") });

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "end" });
    const list = container.querySelector("ol");
    expect(scrollIntoView.mock.contexts[0]).toBe(list?.nextElementSibling);
  });

  it("scrolls when the thread is empty without failing", () => {
    renderThread({ messages: [] });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not scroll again when a refresh brings the same newest message", () => {
    const actions = createActions();
    const view = render(
      <MessageThread
        messages={messagesEnding("newest")}
        username="ana.perez"
        canAct={true}
        {...actions}
      />,
    );

    view.rerender(
      <MessageThread
        messages={[
          message({ id: "older", status: "READ" }),
          message({ id: "newest", status: "READ" }),
        ]}
        username="ana.perez"
        canAct={true}
        {...actions}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls again when a new message arrives or another conversation opens", () => {
    const actions = createActions();
    const view = render(
      <MessageThread
        messages={messagesEnding("m2")}
        username="ana.perez"
        canAct={true}
        {...actions}
      />,
    );

    view.rerender(
      <MessageThread
        messages={[...messagesEnding("m2"), message({ id: "m3" })]}
        username="ana.perez"
        canAct={true}
        {...actions}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    view.rerender(
      <MessageThread
        messages={[message({ id: "other-chat" })]}
        username="luis"
        canAct={true}
        {...actions}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  });
});
