"use client";

import { Minus, Plus } from "lucide-react";

import { MAX_QUANTITY, MIN_QUANTITY } from "@/domain/economy/consumption";
import { Button } from "@/ui/primitives/button";

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function QuantityStepper({ value, onChange, disabled = false }: QuantityStepperProps) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Cantidad">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Menos"
        disabled={disabled || value <= MIN_QUANTITY}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span aria-live="polite" className="min-w-10 text-center text-lg font-semibold">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Más"
        disabled={disabled || value >= MAX_QUANTITY}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  );
}
