"use client";

import { useState } from "react";

import { Button } from "@/ui/primitives/button";
import { FieldError } from "@/ui/primitives/field-error";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

export interface GuestSlotValues {
  name: string;
  instagram: string;
}

interface GuestGroupFieldsProps {
  idFor: (field: string) => string;
  partySize: number;
  maxPartySize: number;
  onPartySizeChange: (next: number) => void;
  defaultGuests: readonly GuestSlotValues[];
  errors: Partial<Record<string, string>> | undefined;
}

const emptySlot: GuestSlotValues = { name: "", instagram: "" };

export function GuestGroupFields({
  idFor,
  partySize,
  maxPartySize,
  onPartySizeChange,
  defaultGuests,
  errors,
}: GuestGroupFieldsProps) {
  const [slots, setSlots] = useState<GuestSlotValues[]>(() =>
    Array.from({ length: Math.max(maxPartySize, partySize, defaultGuests.length) }, (_, index) => ({
      name: defaultGuests[index]?.name ?? "",
      instagram: defaultGuests[index]?.instagram ?? "",
    })),
  );

  function updateSlot(index: number, field: keyof GuestSlotValues, value: string) {
    setSlots((current) => {
      const next = [...current];
      while (next.length <= index) {
        next.push({ ...emptySlot });
      }
      const existing = next[index] ?? emptySlot;
      next[index] = { ...existing, [field]: value };
      return next;
    });
  }

  const partySizeErrorId = idFor("partySize-error");
  const partySizeLabelId = idFor("partySize-label");

  return (
    <>
      <div className="grid gap-2 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span id={partySizeLabelId} className="text-sm font-medium text-foreground">
            Personas
          </span>
          <div
            role="group"
            aria-labelledby={partySizeLabelId}
            aria-describedby={errors?.partySize ? partySizeErrorId : undefined}
            className="flex items-center gap-2"
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Menos personas"
              disabled={partySize <= 1}
              onClick={() => onPartySizeChange(Math.max(1, partySize - 1))}
            >
              -
            </Button>
            <output
              aria-live="polite"
              aria-label="Cantidad de personas"
              className="min-w-8 text-center text-base font-medium tabular-nums"
            >
              {partySize}
            </output>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Más personas"
              disabled={partySize >= maxPartySize}
              onClick={() => onPartySizeChange(Math.min(maxPartySize, partySize + 1))}
            >
              +
            </Button>
          </div>
        </div>
        <input type="hidden" name="partySize" value={partySize} />
        <FieldError id={partySizeErrorId} message={errors?.partySize} />
      </div>
      {Array.from({ length: partySize }, (_, index) => {
        const slot = index + 1;
        const guest = slots[index] ?? emptySlot;
        const nameId = idFor(`guest${slot}Name`);
        const nameErrorId = `${nameId}-error`;
        const nameError = errors?.[`guests.${index}.name`];
        const instagramId = idFor(`guest${slot}Instagram`);
        const instagramErrorId = `${instagramId}-error`;
        const instagramError = errors?.[`guests.${index}.instagram`];

        return (
          <fieldset
            key={slot}
            className="grid min-w-0 gap-4 rounded-xl border border-border p-4 md:col-span-2 md:grid-cols-2"
          >
            <legend className="px-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {slot === 1 ? "Persona 1 · Titular" : `Persona ${slot}`}
            </legend>
            <div className="grid gap-2">
              <Label htmlFor={nameId}>Nombre completo</Label>
              <Input
                id={nameId}
                name="guestName"
                value={guest.name}
                onChange={(event) => updateSlot(index, "name", event.target.value)}
                maxLength={120}
                autoComplete="off"
                required
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? nameErrorId : undefined}
              />
              <FieldError id={nameErrorId} message={nameError} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={instagramId}>Usuario de Instagram</Label>
              <Input
                id={instagramId}
                name="guestInstagram"
                value={guest.instagram}
                onChange={(event) => updateSlot(index, "instagram", event.target.value)}
                autoComplete="off"
                required
                aria-invalid={Boolean(instagramError)}
                aria-describedby={instagramError ? instagramErrorId : undefined}
              />
              <FieldError id={instagramErrorId} message={instagramError} />
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
