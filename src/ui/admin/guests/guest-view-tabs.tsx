import Link from "next/link";

import { Button } from "@/ui/primitives/button";

export interface GuestView {
  id: string;
  label: string;
  count: number;
  href: string;
}

interface GuestViewTabsProps {
  views: readonly GuestView[];
  activeId: string;
}

export function GuestViewTabs({ views, activeId }: GuestViewTabsProps) {
  return (
    <nav className="flex flex-wrap gap-3" aria-label="Vistas del listado">
      {views.map((view) => {
        const active = view.id === activeId;

        return (
          <Button variant={active ? "default" : "outline"} asChild key={view.id}>
            <Link href={view.href} aria-current={active ? "page" : undefined}>
              {view.label} ({view.count})
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
