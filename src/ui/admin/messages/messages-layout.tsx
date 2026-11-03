import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/ui/cn";
import { Button } from "@/ui/primitives/button";

interface MessagesLayoutProps {
  list: ReactNode;
  // Pass the header, thread and composer as direct children (a fragment) so only the thread scrolls.
  conversation: ReactNode;
  backHref: string;
}

export function MessagesLayout({ list, conversation, backHref }: MessagesLayoutProps) {
  const hasConversation = Boolean(conversation);

  // 3.5rem is the height of the mobile admin bar that sits above the page.
  return (
    <div className="flex h-[calc(100svh_-_3.5rem)] min-h-0 md:h-svh">
      <section
        aria-label="Conversaciones"
        className={cn(
          "relative min-h-0 w-full overflow-y-auto md:block md:w-80 md:shrink-0 md:border-r md:border-border",
          hasConversation ? "hidden" : "block",
        )}
      >
        {list}
      </section>
      <section
        aria-label="Conversación"
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          hasConversation ? "flex" : "hidden md:flex",
        )}
      >
        {hasConversation ? (
          <>
            <div className="shrink-0 border-b border-border px-2 py-1 md:hidden">
              <Button variant="ghost" size="sm" asChild>
                <Link href={backHref}>
                  <ArrowLeft aria-hidden="true" />
                  Volver
                </Link>
              </Button>
            </div>
            {conversation}
          </>
        ) : (
          <p className="admin-empty m-auto px-4 text-sm">Selecciona una conversación.</p>
        )}
      </section>
    </div>
  );
}
