// @vitest-environment jsdom

import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyTextButton, OpenInstagramChatLink } from "@/ui/admin/messages/manual-send-buttons";

const writeText = vi.fn();

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

async function clickAndSettle(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  setClipboard({ writeText });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setClipboard(undefined);
});

describe("CopyTextButton", () => {
  it("copies the text and confirms for two seconds", async () => {
    render(<CopyTextButton text="Hola Ana" label="Copiar texto" />);

    await clickAndSettle(screen.getByRole("button", { name: "Copiar texto" }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith("Hola Ana");
    expect(screen.getByRole("button", { name: "Copiado" })).toBeDefined();

    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.getByRole("button", { name: "Copiado" })).toBeDefined();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("button", { name: "Copiar texto" })).toBeDefined();
  });

  it("restarts the two seconds when copied again", async () => {
    render(<CopyTextButton text="Hola Ana" label="Copiar texto" />);

    await clickAndSettle(screen.getByRole("button", { name: "Copiar texto" }));
    act(() => vi.advanceTimersByTime(1_500));
    await clickAndSettle(screen.getByRole("button", { name: "Copiado" }));
    act(() => vi.advanceTimersByTime(1_500));

    expect(screen.getByRole("button", { name: "Copiado" })).toBeDefined();

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("button", { name: "Copiar texto" })).toBeDefined();
  });

  it("says it could not copy when the clipboard rejects the text", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<CopyTextButton text="Hola Ana" label="Copiar texto" />);

    await clickAndSettle(screen.getByRole("button", { name: "Copiar texto" }));

    expect(screen.getByRole("button", { name: "No se pudo copiar" })).toBeDefined();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("button", { name: "Copiar texto" })).toBeDefined();
  });

  it("says it could not copy when the browser has no clipboard", async () => {
    setClipboard(undefined);
    render(<CopyTextButton text="Hola Ana" label="Copiar" />);

    await clickAndSettle(screen.getByRole("button", { name: "Copiar" }));

    expect(screen.getByRole("button", { name: "No se pudo copiar" })).toBeDefined();
  });

  it("can be disabled", () => {
    render(<CopyTextButton text="" label="Copiar" disabled />);

    expect(screen.getByRole("button", { name: "Copiar" }).hasAttribute("disabled")).toBe(true);
  });

  it("leaves no timer behind after unmount", async () => {
    const view = render(<CopyTextButton text="Hola Ana" label="Copiar texto" />);
    await clickAndSettle(screen.getByRole("button", { name: "Copiar texto" }));

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("OpenInstagramChatLink", () => {
  it("opens the Instagram chat in a new tab", () => {
    render(<OpenInstagramChatLink username="ana.perez" />);

    const link = screen.getByRole("link", { name: "Abrir chat en Instagram" });
    expect(link.getAttribute("href")).toBe("https://ig.me/m/ana.perez");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
