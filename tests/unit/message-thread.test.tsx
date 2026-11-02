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
    createdAt: new Date("2026-11-03T16:30:00Z"),
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

describe("MessageThread unsupported content", () => {
  it("renders a muted italic placeholder for messages with no text and no image", () => {
    renderThread({
      messages: [
        message({
          id: "m1",
          direction: "INBOUND",
          kind: "INBOUND",
          status: "RECEIVED",
          body: null,
        }),
        message({ id: "m2", source: "INSTAGRAM_APP", body: "[contenido no compatible]" }),
        message({ id: "m3", body: "Hola" }),
      ],
    });

    const placeholders = screen.getAllByText("Este mensaje no es soportado.");
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]!.className).toContain("italic");
    expect(screen.queryByText("[contenido no compatible]")).toBeNull();
    expect(screen.getByText("Hola")).toBeDefined();
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

    const groups = Array.from(screen.getByRole("list", { name: "Mensajes" }).children).slice(1);
    expect(groups.map((group) => group.textContent)).toEqual([
      expect.stringContaining("Primero"),
      expect.stringContaining("Segundo"),
      expect.stringContaining("Tercero"),
    ]);
    expect(groups[0]!.className).toContain("items-start");
    expect(groups[1]!.className).toContain("items-end");
    expect(groups[2]!.className).toContain("items-start");
  });

  it("styles inbound bubbles muted and outbound bubbles cream with a 6px tail corner", () => {
    renderThread({
      messages: [
        message({
          id: "m1",
          direction: "INBOUND",
          kind: "INBOUND",
          status: "RECEIVED",
          body: "Hola",
        }),
        message({ id: "m2", body: "Uno" }),
        message({ id: "m3", body: "Dos" }),
      ],
    });

    const inbound = screen.getByText("Hola").parentElement!;
    const first = screen.getByText("Uno").parentElement!;
    const last = screen.getByText("Dos").parentElement!;
    expect(inbound.className).toContain("bg-muted");
    expect(inbound.className).toContain("rounded-bl-[6px]");
    expect(first.className).toContain("bg-primary");
    expect(first.className).not.toContain("rounded-br-[6px]");
    expect(last.className).toContain("rounded-br-[6px]");
  });

  it("labels automatic messages with their kind and shows the status under the group", () => {
    renderThread({
      messages: [
        message({
          kind: "CLUE",
          source: "SYSTEM",
          status: "READ",
          body: "Busca la puerta azul",
          createdAt: new Date("2026-11-04T03:05:00Z"),
        }),
      ],
    });

    const bubble = bubbleOf("Busca la puerta azul");
    expect(within(bubble).getByText("Automático · Pista")).toBeDefined();
    expect(screen.getByText("Leído")).toBeDefined();
    expect(screen.getByText("21:05")).toBeDefined();
  });

  it("does not label messages written by an admin as automatic", () => {
    renderThread({ messages: [message({ source: "ADMIN", body: "Hola" })] });

    expect(screen.queryByText(/Automático/)).toBeNull();
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
          createdAt: new Date("2026-11-03T16:42:00Z"),
        }),
      ],
    });

    const bubble = bubbleOf("¿A qué hora es?");
    expect(screen.getByText("10:42")).toBeDefined();
    expect(screen.queryByText("Recibido")).toBeNull();
    expect(within(bubble).getByText("Mensaje recibido").className).toContain("sr-only");
    expect(within(bubble).queryByRole("button", { name: /Reintentar|Descartar/ })).toBeNull();
  });

  it("keeps line breaks in the text", () => {
    renderThread({ messages: [message({ body: "Primera línea\nSegunda línea" })] });

    const text = screen.getByText(
      (_, element) =>
        element?.tagName === "P" && element.textContent === "Primera línea\nSegunda línea",
    );
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
    ["WAITING_CONTACT", "En espera: aún no nos escribe"],
    ["WAITING_WINDOW", "En espera: ventana cerrada"],
    ["QUEUED", "En espera"],
    ["SENT", "Enviado"],
    ["READ", "Leído"],
    ["FAILED", "No se pudo"],
    ["SENT_MANUALLY", "Enviado a mano"],
    ["DISCARDED", "Descartado"],
  ] as const)("labels an outbound %s message", (status, label) => {
    renderThread({ messages: [message({ status, body: "Texto del mensaje" })] });

    expect(screen.getByText(label)).toBeDefined();
  });

  it.each([
    ["WAITING_WINDOW", "lucide-clock"],
    ["QUEUED", "lucide-clock"],
    ["SENT", "lucide-check"],
    ["READ", "lucide-check-check"],
    ["FAILED", "lucide-circle-alert"],
  ] as const)("draws the %s icon", (status, iconClass) => {
    renderThread({ messages: [message({ status })] });

    expect(document.querySelector(`svg.${iconClass}`)).not.toBeNull();
  });

  it("colors only the failed status as an error", () => {
    renderThread({
      messages: [message({ id: "m1", status: "FAILED" }), message({ id: "m2", status: "SENT" })],
    });

    expect(screen.getByText("No se pudo").className).toContain("text-destructive");
    expect(screen.getByText("Enviado").className).not.toContain("text-destructive");
  });

  it("shows one status for the whole group, taken from its newest message", () => {
    renderThread({
      messages: [
        message({ id: "m1", status: "SENT", body: "Uno" }),
        message({ id: "m2", status: "READ", body: "Dos" }),
      ],
    });

    expect(screen.getByText("Leído")).toBeDefined();
    expect(screen.queryByText("Enviado")).toBeNull();
  });
});

describe("MessageThread grouping and dates", () => {
  const at = (iso: string) => new Date(iso);

  it("groups same-direction messages within five minutes under one time", () => {
    renderThread({
      messages: [
        message({ id: "m1", body: "Uno", createdAt: at("2026-11-03T16:00:00Z") }),
        message({ id: "m2", body: "Dos", createdAt: at("2026-11-03T16:05:00Z") }),
        message({ id: "m3", body: "Tres", createdAt: at("2026-11-03T16:10:30Z") }),
      ],
    });

    const groups = Array.from(screen.getByRole("list", { name: "Mensajes" }).children).slice(1);
    expect(groups).toHaveLength(2);
    const first = within(groups[0] as HTMLElement);
    expect(first.getByText("Uno")).toBeDefined();
    expect(first.getByText("Dos")).toBeDefined();
    expect(first.getAllByText(/^\d\d:\d\d$/)).toHaveLength(1);
    expect(first.getByText("10:05")).toBeDefined();
    expect(within(groups[1] as HTMLElement).getByText("Tres")).toBeDefined();
  });

  it("starts a new group when the direction changes", () => {
    renderThread({
      messages: [
        message({ id: "m1", body: "Uno" }),
        message({
          id: "m2",
          direction: "INBOUND",
          kind: "INBOUND",
          status: "RECEIVED",
          body: "Dos",
        }),
        message({ id: "m3", body: "Tres" }),
      ],
    });

    expect(Array.from(screen.getByRole("list", { name: "Mensajes" }).children)).toHaveLength(4);
  });

  it("separates days with Hoy, Ayer and a long date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-11-03T18:00:00Z"));
    renderThread({
      messages: [
        message({ id: "m1", body: "Viejo", createdAt: at("2026-10-30T16:00:00Z") }),
        message({ id: "m2", body: "De ayer", createdAt: at("2026-11-02T16:00:00Z") }),
        message({ id: "m3", body: "De hoy", createdAt: at("2026-11-03T16:00:00Z") }),
      ],
    });

    const items = Array.from(screen.getByRole("list", { name: "Mensajes" }).children);
    expect(items.map((item) => item.textContent)).toEqual([
      "30 de octubre",
      expect.stringContaining("Viejo"),
      "Ayer",
      expect.stringContaining("De ayer"),
      "Hoy",
      expect.stringContaining("De hoy"),
    ]);
  });

  it("does not merge messages from different days into one group", () => {
    renderThread({
      messages: [
        message({ id: "m1", body: "Noche", createdAt: at("2026-11-03T05:58:00Z") }),
        message({ id: "m2", body: "Madrugada", createdAt: at("2026-11-03T06:01:00Z") }),
      ],
    });

    expect(Array.from(screen.getByRole("list", { name: "Mensajes" }).children)).toHaveLength(4);
  });

  it("animates only messages that arrive after the first render", () => {
    const actions = createActions();
    const view = render(
      <MessageThread
        messages={[message({ id: "m1", body: "Uno" })]}
        username="ana"
        canAct
        {...actions}
      />,
    );

    view.rerender(
      <MessageThread
        messages={[message({ id: "m1", body: "Uno" }), message({ id: "m2", body: "Dos" })]}
        username="ana"
        canAct
        {...actions}
      />,
    );

    expect(bubbleOf("Uno").className).not.toContain("admin-chat-in");
    expect(bubbleOf("Dos").className).toContain("admin-chat-in");
  });
});

describe("MessageThread jump to latest", () => {
  function scrollThread(container: HTMLElement, distanceFromLatest: number) {
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 600 - distanceFromLatest,
    });
    fireEvent.scroll(scroller);
  }

  it("is hidden at the bottom and appears after scrolling up more than 200px", () => {
    const { container } = renderThread();
    expect(screen.queryByRole("button", { name: "Ir al último mensaje" })).toBeNull();

    scrollThread(container, 200);
    expect(screen.queryByRole("button", { name: "Ir al último mensaje" })).toBeNull();

    scrollThread(container, 201);
    expect(screen.getByRole("button", { name: "Ir al último mensaje" })).toBeDefined();

    scrollThread(container, 0);
    expect(screen.queryByRole("button", { name: "Ir al último mensaje" })).toBeNull();
  });

  it("scrolls smoothly to the newest message when pressed", () => {
    const { container } = renderThread();
    scrollThread(container, 500);
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Ir al último mensaje" }));

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", block: "end" });
  });

  it("is not offered in threads that do not follow the newest message", () => {
    const { container } = renderThread({ scrollToNewest: false });

    scrollThread(container, 500);

    expect(screen.queryByRole("button", { name: "Ir al último mensaje" })).toBeNull();
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
    expect(screen.getByText("No se pudo")).toBeDefined();
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
