"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { cn } from "@/ui/cn";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label="Actualizar"
      title="Actualizar"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[#8d8b85] transition-colors duration-200 disabled:opacity-40 [@media(hover:hover)_and_(pointer:fine)]:hover:text-[#fffbf4]"
    >
      <RefreshCw aria-hidden="true" className={cn("size-4", pending && "animate-spin")} />
    </button>
  );
}
