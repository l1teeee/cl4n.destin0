"use client";

import type { ReactNode } from "react";

import { Button } from "@/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/ui/primitives/sheet";

import { GuestAllergies } from "./guest-allergies";
import { GuestIdentityList, type GuestIdentity } from "./guest-identity-list";

export interface GuestTimelineEntry {
  label: string;
  at: string;
}

interface GuestDetailSheetProps {
  triggerLabel: string;
  title: string;
  subtitle: string;
  guests: readonly GuestIdentity[];
  partyLabel: string;
  allergies: string | null;
  notes: string | null;
  timeline: readonly GuestTimelineEntry[];
  messages: ReactNode;
  actions: ReactNode;
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 py-4">
      <h3 className="admin-section-title">{title}</h3>
      {children}
    </section>
  );
}

export function GuestDetailSheet({
  triggerLabel,
  title,
  subtitle,
  guests,
  partyLabel,
  allergies,
  notes,
  timeline,
  messages,
  actions,
}: GuestDetailSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm">
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-border sm:max-w-lg"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>
        <div className="divide-y divide-border px-4 pb-8">
          <DetailSection title="Invitados">
            <GuestIdentityList guests={guests} />
          </DetailSection>
          <DetailSection title="Personas">
            <p>{partyLabel}</p>
          </DetailSection>
          <DetailSection title="Alergias">
            <GuestAllergies allergies={allergies} />
          </DetailSection>
          {notes ? (
            <DetailSection title="Observaciones">
              <p className="break-words whitespace-pre-line">{notes}</p>
            </DetailSection>
          ) : null}
          {timeline.length > 0 ? (
            <DetailSection title="Historial">
              <ol className="grid gap-2">
                {timeline.map((entry, index) => (
                  <li
                    key={`${index}-${entry.label}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm"
                  >
                    <span>{entry.label}</span>
                    <span className="admin-muted text-xs">{entry.at}</span>
                  </li>
                ))}
              </ol>
            </DetailSection>
          ) : null}
          {messages ? <DetailSection title="Mensajes">{messages}</DetailSection> : null}
          {actions ? <DetailSection title="Acciones">{actions}</DetailSection> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
