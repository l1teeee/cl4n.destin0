import Link from "next/link";

import { cn } from "@/ui/cn";
import { Alert } from "@/ui/primitives/alert";

import type { MessagingHealthView } from "./messaging-health-view";

interface MessagingHealthBannerProps {
  view: MessagingHealthView;
  showUnsentLink: boolean;
  className?: string;
}

export function MessagingHealthBanner({
  view,
  showUnsentLink,
  className,
}: MessagingHealthBannerProps) {
  if (!view.failing && view.lastSignalLabel === null) return null;

  if (!view.failing) {
    return <p className={cn("text-xs text-[#8d8b85]", className)}>{view.lastSignalLabel}</p>;
  }

  return (
    <Alert variant="destructive" role="status" className={className}>
      <div className="grid gap-1.5">
        {view.title ? <p className="font-medium text-[#fffbf4]">{view.title}</p> : null}
        {view.detail ? <p className="text-sm">{view.detail}</p> : null}
        {showUnsentLink ? (
          <Link href="/admin/mensajes/sin-enviar" className="text-sm underline underline-offset-4">
            Ver mensajes sin enviar
          </Link>
        ) : null}
        {view.lastSignalLabel ? (
          <p className="text-xs text-[#8d8b85]">{view.lastSignalLabel}</p>
        ) : null}
      </div>
    </Alert>
  );
}
