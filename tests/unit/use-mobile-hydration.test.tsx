// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useIsMobile } from "@/ui/hooks/use-mobile";

function MobileProbe() {
  return <p>{useIsMobile() ? "mobile" : "desktop"}</p>;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("useIsMobile hydration", () => {
  it("hydrates at 390px without a recoverable hydration error", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const container = document.createElement("div");
    const serverHtml = renderToString(<MobileProbe />);
    container.innerHTML = serverHtml;
    document.body.append(container);
    const onRecoverableError = vi.fn();

    const root = hydrateRoot(container, <MobileProbe />, { onRecoverableError });
    await act(async () => {});

    expect(serverHtml).toContain("desktop");
    expect(container.textContent).toBe("mobile");
    expect(onRecoverableError).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});
