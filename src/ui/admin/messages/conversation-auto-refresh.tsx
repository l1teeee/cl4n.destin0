"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { isNotificationSoundEnabled, playNotificationChime } from "@/ui/admin/notification-sound";

const REFRESH_INTERVAL_MS = 10_000;
const REFRESH_THROTTLE_MS = 2_000;

interface ConversationAutoRefreshProps {
  newestInboundMessageId: string | null;
}

export function ConversationAutoRefresh({ newestInboundMessageId }: ConversationAutoRefreshProps) {
  const router = useRouter();
  const knownInboundMessageId = useRef(newestInboundMessageId);
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    const previousId = knownInboundMessageId.current;
    knownInboundMessageId.current = newestInboundMessageId;

    if (newestInboundMessageId !== null && newestInboundMessageId !== previousId) {
      if (isNotificationSoundEnabled()) playNotificationChime();
    }
  }, [newestInboundMessageId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        lastRefreshAt.current = Date.now();
        router.refresh();
      }
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [router]);

  useEffect(() => {
    function onRefresh() {
      const now = Date.now();
      if (now - lastRefreshAt.current < REFRESH_THROTTLE_MS) {
        return;
      }
      lastRefreshAt.current = now;
      router.refresh();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        onRefresh();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onRefresh);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onRefresh);
    };
  }, [router]);

  return null;
}
