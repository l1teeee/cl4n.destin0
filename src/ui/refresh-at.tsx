"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const MAX_TIMEOUT_MS = 2_147_483_647;
// Refresh just after the transition so the server already sees the new phase.
const SETTLE_MS = 1_000;

export function RefreshAt({ delayMs }: { delayMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const wait = Math.max(0, delayMs) + SETTLE_MS;
    if (wait > MAX_TIMEOUT_MS) return;
    const timer = window.setTimeout(() => router.refresh(), wait);
    return () => window.clearTimeout(timer);
  }, [delayMs, router]);
  return null;
}
