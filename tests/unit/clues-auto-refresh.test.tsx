// @vitest-environment jsdom

import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CluesAutoRefresh } from "@/ui/public/clues-auto-refresh";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CluesAutoRefresh", () => {
  it("refreshes every 30 seconds while visible", () => {
    render(<CluesAutoRefresh />);

    act(() => vi.advanceTimersByTime(60_000));

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("skips refreshes while hidden", () => {
    render(<CluesAutoRefresh />);
    setVisibility("hidden");

    act(() => vi.advanceTimersByTime(60_000));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops after unmount", () => {
    const view = render(<CluesAutoRefresh />);
    view.unmount();

    act(() => vi.advanceTimersByTime(60_000));

    expect(refresh).not.toHaveBeenCalled();
  });
});
