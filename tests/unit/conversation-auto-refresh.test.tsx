// @vitest-environment jsdom

import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationAutoRefresh } from "@/ui/admin/messages/conversation-auto-refresh";

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

describe("ConversationAutoRefresh", () => {
  it("renders nothing", () => {
    const { container } = render(<ConversationAutoRefresh />);

    expect(container.firstChild).toBeNull();
  });

  it("does not refresh before ten seconds have passed", () => {
    render(<ConversationAutoRefresh />);

    act(() => vi.advanceTimersByTime(9_999));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes every ten seconds while the tab is visible", () => {
    render(<ConversationAutoRefresh />);

    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(20_000));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("skips refreshes while the tab is hidden and resumes when it is visible again", () => {
    render(<ConversationAutoRefresh />);
    setVisibility("hidden");

    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).not.toHaveBeenCalled();

    setVisibility("visible");
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops after unmount", () => {
    const view = render(<ConversationAutoRefresh />);
    view.unmount();

    act(() => vi.advanceTimersByTime(60_000));

    expect(refresh).not.toHaveBeenCalled();
  });
});
