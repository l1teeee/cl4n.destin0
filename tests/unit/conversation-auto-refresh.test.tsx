// @vitest-environment jsdom

import { act } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationAutoRefresh } from "@/ui/admin/messages/conversation-auto-refresh";

const { refresh, sound } = vi.hoisted(() => ({
  refresh: vi.fn(),
  sound: { enabled: true, play: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/ui/admin/notification-sound", () => ({
  isNotificationSoundEnabled: () => sound.enabled,
  playNotificationChime: sound.play,
}));

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  sound.play.mockReset();
  sound.enabled = true;
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ConversationAutoRefresh", () => {
  it("renders nothing", () => {
    const { container } = render(<ConversationAutoRefresh newestInboundMessageId="m1" />);

    expect(container.firstChild).toBeNull();
  });

  it("does not refresh before ten seconds have passed", () => {
    render(<ConversationAutoRefresh newestInboundMessageId="m1" />);

    act(() => vi.advanceTimersByTime(9_999));

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes every ten seconds while the tab is visible", () => {
    render(<ConversationAutoRefresh newestInboundMessageId="m1" />);

    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(20_000));
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("skips refreshes while the tab is hidden and resumes when it is visible again", () => {
    render(<ConversationAutoRefresh newestInboundMessageId="m1" />);
    setVisibility("hidden");

    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).not.toHaveBeenCalled();

    setVisibility("visible");
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops after unmount", () => {
    const view = render(<ConversationAutoRefresh newestInboundMessageId="m1" />);
    view.unmount();

    act(() => vi.advanceTimersByTime(60_000));

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ConversationAutoRefresh chime", () => {
  it("stays silent on the first render", () => {
    render(<ConversationAutoRefresh newestInboundMessageId="m1" />);

    expect(sound.play).not.toHaveBeenCalled();
  });

  it("plays once when a newer inbound message arrives", () => {
    const view = render(<ConversationAutoRefresh newestInboundMessageId="m1" />);

    view.rerender(<ConversationAutoRefresh newestInboundMessageId="m2" />);
    expect(sound.play).toHaveBeenCalledTimes(1);

    view.rerender(<ConversationAutoRefresh newestInboundMessageId="m2" />);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("plays when the first inbound message arrives in an empty conversation", () => {
    const view = render(<ConversationAutoRefresh newestInboundMessageId={null} />);

    view.rerender(<ConversationAutoRefresh newestInboundMessageId="m1" />);

    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("stays silent when sound is muted", () => {
    sound.enabled = false;
    const view = render(<ConversationAutoRefresh newestInboundMessageId="m1" />);

    view.rerender(<ConversationAutoRefresh newestInboundMessageId="m2" />);

    expect(sound.play).not.toHaveBeenCalled();
  });
});
