// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RefreshAt } from "@/ui/refresh-at";

const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});

vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RefreshAt", () => {
  it("refreshes once after the delay and settling time", () => {
    render(<RefreshAt delayMs={5000} />);
    vi.advanceTimersByTime(5999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10000);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("waits for settling time for a negative delay", () => {
    render(<RefreshAt delayMs={-1} />);
    vi.advanceTimersByTime(999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not schedule a timeout above the maximum", () => {
    render(<RefreshAt delayMs={2_147_483_647} />);
    expect(vi.getTimerCount()).toBe(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the timeout on unmount", () => {
    const { unmount } = render(<RefreshAt delayMs={5000} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(6000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
