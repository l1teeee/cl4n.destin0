"use client";

import type { ReactNode } from "react";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

export function LinkPendingIndicator() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null;
}

export function LinkPendingIcon({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : children;
}
