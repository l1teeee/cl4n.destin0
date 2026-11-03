"use client";

import { Loader2 } from "lucide-react";

import type { PickerItem } from "@/application/extras/extra-repository";
import { formatDrinkPrice } from "@/domain/drink/drink-price";
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
        <div className="flex flex-wrap gap-2">
          {items.map((item) => {
            const key = catalogKey(source, item);
            const pending = pendingKey === key;
            return (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant="outline"
                className="h-auto min-h-10 max-w-full gap-2 px-3.5 py-1.5 text-left text-sm font-normal tracking-normal whitespace-normal sm:min-h-9"
                aria-label={itemButtonLabel(item)}
                disabled={pendingKey !== null}
                aria-busy={pending}
                onClick={() => onAdd(source, item)}
              >
                <span>{item.name}</span>
                <span className="text-muted-foreground">{formatDrinkPrice(item.priceCents)}</span>
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
