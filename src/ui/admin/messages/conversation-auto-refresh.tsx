"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { isNotificationSoundEnabled, playNotificationChime } from "@/ui/admin/notification-sound";

const REFRESH_INTERVAL_MS = 10_000;

interface ConversationAutoRefreshProps {
  newestInboundMessageId: string | null;
}

export function ConversationAutoRefresh({ newestInboundMessageId }: ConversationAutoRefreshProps) {
  const router = useRouter();
  const knownInboundMessageId = useRef(newestInboundMessageId);

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
        router.refresh();
      }
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
