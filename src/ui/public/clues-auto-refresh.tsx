"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function CluesAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
