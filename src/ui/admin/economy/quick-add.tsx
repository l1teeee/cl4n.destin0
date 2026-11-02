"use client";

import { Loader2 } from "lucide-react";

import type { PickerItem } from "@/application/extras/extra-repository";
import { Button } from "@/ui/primitives/button";

import { itemButtonLabel } from "./economy-view";

export type CatalogSource = "DRINK" | "EXTRA";

interface QuickAddProps {
  drinks: readonly PickerItem[];
  extras: readonly PickerItem[];
  pendingKey: string | null;
  onAdd: (source: CatalogSource, item: PickerItem) => void;
}

interface ItemGroupProps {
  title: string;
  emptyText: string;
  source: CatalogSource;
  items: readonly PickerItem[];
  pendingKey: string | null;
  onAdd: QuickAddProps["onAdd"];
}

export function catalogKey(source: CatalogSource, item: PickerItem): string {
  return `${source}:${item.id}`;
}

function ItemGroup({ title, emptyText, source, items, pendingKey, onAdd }: ItemGroupProps) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h4 className="admin-section-title">{title}</h4>
      {items.length === 0 ? (
        <p className="admin-muted">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {items.map((item) => {
            const key = catalogKey(source, item);
            const pending = pendingKey === key;
            return (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                className="h-auto min-h-11 justify-between gap-3 px-4 py-2 text-left tracking-normal whitespace-normal"
                disabled={pendingKey !== null}
                aria-busy={pending}
                onClick={() => onAdd(source, item)}
              >
                <span>{itemButtonLabel(item)}</span>
                {pending ? <Loader2 className="animate-spin" /> : null}
              </Button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function QuickAdd({ drinks, extras, pendingKey, onAdd }: QuickAddProps) {
  return (
    <div className="grid gap-5">
      <ItemGroup
        title="Bebidas"
        emptyText="No hay bebidas en el menú."
        source="DRINK"
        items={drinks}
        pendingKey={pendingKey}
        onAdd={onAdd}
      />
      <ItemGroup
        title="Extras"
        emptyText="No hay extras disponibles."
        source="EXTRA"
        items={extras}
        pendingKey={pendingKey}
        onAdd={onAdd}
      />
    </div>
  );
}
