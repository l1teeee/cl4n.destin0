// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as NotificationSound from "@/ui/admin/notification-sound";

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "suspended";
  currentTime = 1;
  destination = {};
  oscillators: { frequency: { setValueAtTime: ReturnType<typeof vi.fn> } }[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const oscillator = {
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }
}

let sound: typeof NotificationSound;

beforeEach(async () => {
  vi.resetModules();
  FakeAudioContext.instances = [];
  window.localStorage.clear();
  vi.stubGlobal("AudioContext", FakeAudioContext);
  sound = await import("@/ui/admin/notification-sound");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notification chime", () => {
  it("skips silently until the user has interacted with the page", () => {
    const removeListeners = sound.installAudioUnlock();

    sound.playNotificationChime();

    expect(FakeAudioContext.instances).toHaveLength(0);
    removeListeners();
  });

  it("creates the audio context on the first gesture and plays two soft notes", async () => {
    const removeListeners = sound.installAudioUnlock();
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();

    sound.playNotificationChime();

    const [context] = FakeAudioContext.instances;
    const frequencies = context?.oscillators.map(
      (o) => o.frequency.setValueAtTime.mock.calls[0]?.[0],
    );
    expect(frequencies).toEqual([880, 1320]);
    removeListeners();
  });

  it("ignores a second chime inside the 3 second cooldown", async () => {
    vi.useFakeTimers();
    const removeListeners = sound.installAudioUnlock();
    window.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();

    sound.playNotificationChime();
    sound.playNotificationChime();
    vi.advanceTimersByTime(3_000);
    sound.playNotificationChime();

    expect(FakeAudioContext.instances[0]?.oscillators).toHaveLength(4);
    removeListeners();
    vi.useRealTimers();
  });

  it("stops listening for gestures after cleanup", () => {
    const removeListeners = sound.installAudioUnlock();
    removeListeners();

    window.dispatchEvent(new Event("keydown"));

    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});

describe("notification sound preference", () => {
  it("defaults to on and persists the choice", () => {
    expect(sound.isNotificationSoundEnabled()).toBe(true);

    sound.setNotificationSoundEnabled(false);
    expect(window.localStorage.getItem("cl4n_admin_sound")).toBe("off");
    expect(sound.isNotificationSoundEnabled()).toBe(false);

    sound.setNotificationSoundEnabled(true);
    expect(window.localStorage.getItem("cl4n_admin_sound")).toBe("on");
    expect(sound.isNotificationSoundEnabled()).toBe(true);
  });

  it("notifies subscribers when the choice changes", () => {
    const listener = vi.fn();
    const unsubscribe = sound.subscribeToNotificationSoundPreference(listener);

    sound.setNotificationSoundEnabled(false);
    unsubscribe();
    sound.setNotificationSoundEnabled(true);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
