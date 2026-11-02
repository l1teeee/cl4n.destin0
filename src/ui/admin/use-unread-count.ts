"use client";

import { useEffect, useRef, useState } from "react";

import {
  installAudioUnlock,
  isNotificationSoundEnabled,
  playNotificationChime,
} from "./notification-sound";

const POLL_INTERVAL_MS = 15_000;
const UNREAD_ENDPOINT = "/api/admin/unread";

// WHY: a failed poll must not disturb the admin; the last known count stays on screen.
async function fetchUnreadCount(): Promise<number | null> {
  try {
    const response = await fetch(UNREAD_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const count = (body as { count?: unknown }).count;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

export function useUnreadCount(initialCount: number): number {
  const [count, setCount] = useState(initialCount);
  const [syncedInitialCount, setSyncedInitialCount] = useState(initialCount);
  const previousCountRef = useRef(initialCount);

  // The layout re-renders with a fresh server count after router.refresh().
  if (syncedInitialCount !== initialCount) {
    setSyncedInitialCount(initialCount);
    setCount(initialCount);
  }

  useEffect(() => installAudioUnlock(), []);

  useEffect(() => {
    if (count > previousCountRef.current && isNotificationSoundEnabled()) {
      playNotificationChime();
    }
    previousCountRef.current = count;
  }, [count]);

  useEffect(() => {
    let active = true;

    async function refreshCount() {
      if (document.visibilityState !== "visible") return;
      const latestCount = await fetchUnreadCount();
      if (active && latestCount !== null) setCount(latestCount);
    }

    const interval = window.setInterval(refreshCount, POLL_INTERVAL_MS);
    window.addEventListener("focus", refreshCount);
    document.addEventListener("visibilitychange", refreshCount);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshCount);
      document.removeEventListener("visibilitychange", refreshCount);
    };
  }, []);

  return count;
}
