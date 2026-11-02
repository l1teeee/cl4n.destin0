// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sound = vi.hoisted(() => ({
  enabled: true,
  play: vi.fn(),
  install: vi.fn(() => () => {}),
}));

vi.mock("@/ui/admin/notification-sound", () => ({
  installAudioUnlock: sound.install,
  isNotificationSoundEnabled: () => sound.enabled,
  playNotificationChime: sound.play,
}));

const { useUnreadCount } = await import("@/ui/admin/use-unread-count");

const fetchMock = vi.fn();
let visibility: DocumentVisibilityState = "visible";

function respondWithCount(count: number) {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ count }) });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sound.enabled = true;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

describe("useUnreadCount", () => {
  it("starts from the server count without playing a sound", () => {
    const { result } = renderHook(() => useUnreadCount(2));

    expect(result.current).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sound.play).not.toHaveBeenCalled();
  });

  it("polls every 15 seconds and plays the sound only when the count goes up", async () => {
    const { result } = renderHook(() => useUnreadCount(1));

    respondWithCount(3);
    await advance(15_000);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/unread", { cache: "no-store" });
    expect(result.current).toBe(3);
    expect(sound.play).toHaveBeenCalledTimes(1);

    respondWithCount(3);
    await advance(15_000);
    expect(sound.play).toHaveBeenCalledTimes(1);

    respondWithCount(1);
    await advance(15_000);
    expect(result.current).toBe(1);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("stays silent when sound is muted", async () => {
    sound.enabled = false;
    const { result } = renderHook(() => useUnreadCount(0));

    respondWithCount(2);
    await advance(15_000);

    expect(result.current).toBe(2);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it("does not poll while the page is hidden and refreshes when it becomes visible", async () => {
    const { result } = renderHook(() => useUnreadCount(0));

    visibility = "hidden";
    await advance(45_000);
    expect(fetchMock).not.toHaveBeenCalled();

    visibility = "visible";
    respondWithCount(5);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(5);
  });

  it("refreshes immediately on window focus", async () => {
    const { result } = renderHook(() => useUnreadCount(0));

    respondWithCount(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(result.current).toBe(1);
  });

  it("keeps the last count when a request fails", async () => {
    const { result } = renderHook(() => useUnreadCount(4));

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await advance(15_000);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await advance(15_000);

    expect(result.current).toBe(4);
    expect(sound.play).not.toHaveBeenCalled();
  });

  it("adopts a new server count and plays the sound when it goes up", () => {
    const { result, rerender } = renderHook(({ count }) => useUnreadCount(count), {
      initialProps: { count: 1 },
    });

    rerender({ count: 2 });

    expect(result.current).toBe(2);
    expect(sound.play).toHaveBeenCalledTimes(1);
  });

  it("stops polling after unmount", async () => {
    const { unmount } = renderHook(() => useUnreadCount(0));

    unmount();
    await advance(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
