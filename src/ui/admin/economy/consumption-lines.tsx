"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import type { ConsumptionLine } from "@/application/economy/economy-repository";
import { formatDrinkPrice } from "@/domain/drink/drink-price";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/primitives/alert-dialog";
import { Button } from "@/ui/primitives/button";

import { lineQuantityLabel, lineTimeLabel } from "./economy-view";

interface ConsumptionLinesProps {
  lines: readonly ConsumptionLine[];
  pendingKey: string | null;
  onVoid: (line: ConsumptionLine) => Promise<AdminActionState>;
}

interface VoidLineButtonProps {
  line: ConsumptionLine;
  pending: boolean;
  disabled: boolean;
  onVoid: ConsumptionLinesProps["onVoid"];
}

export function voidKey(line: ConsumptionLine): string {
  return `VOID:${line.id}`;
}

function VoidLineButton({ line, pending, disabled, onVoid }: VoidLineButtonProps) {
  const [open, setOpen] = useState(false);

  async function confirm(): Promise<void> {
    const result = await onVoid(line);
    if (result.ok) setOpen(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={disabled}
          aria-label={`Anular ${line.itemName}`}
        >
          Anular
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular este consumo?</AlertDialogTitle>
          <AlertDialogDescription>
            {line.quantity} × {line.itemName} ({formatDrinkPrice(line.totalCents)}) dejará de
            sumarse a la cuenta. El consumo queda en el historial.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Anular consumo
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConsumptionLines({ lines, pendingKey, onVoid }: ConsumptionLinesProps) {
  if (lines.length === 0) return <p className="admin-empty">Sin consumos todavía.</p>;

  return (
    <ul className="divide-y divide-border">
      {lines.map((line) => {
        const voided = line.voidedAt !== null;
        return (
          <li
            key={line.id}
            data-voided={voided}
            className={`flex items-center justify-between gap-3 py-3 ${voided ? "text-muted-foreground" : ""}`}
          >
            <div className={`min-w-0 ${voided ? "line-through" : ""}`}>
              <p className="font-medium break-words">{line.itemName}</p>
              <p className="admin-muted">
                {lineQuantityLabel(line)} · {lineTimeLabel(line)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className={`font-semibold ${voided ? "line-through" : ""}`}>
                {formatDrinkPrice(line.totalCents)}
              </span>
              {voided ? (
                <span className="admin-muted">Anulado</span>
              ) : (
                <VoidLineButton
                  line={line}
                  pending={pendingKey === voidKey(line)}
                  disabled={pendingKey !== null}
                  onVoid={onVoid}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
