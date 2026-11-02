"use client";

import { useFormStatus } from "react-dom";

import type { WaitingQueueEntry } from "@/infrastructure/db/repositories/event-guest-queries";
import { Button } from "@/ui/primitives/button";

import { guestsLabel, partySizeLabel } from "./guest-copy";

interface QueueReplacementListProps {
  waiting: readonly WaitingQueueEntry[];
  releasedSeats: number;
  onBack: () => void;
}

// Each row's button is a submit button named replacementEntryId, so the form posts the entry
// that was pressed.
function QueueEntryRow({
  entry,
  releasedSeats,
}: {
  entry: WaitingQueueEntry;
  releasedSeats: number;
}) {
  const { pending } = useFormStatus();
  const fits = entry.partySize <= releasedSeats;

  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1 text-sm">
      <span className="admin-muted w-8 shrink-0 font-mono">#{entry.position}</span>
      <span className="min-w-0 flex-1 break-words">{guestsLabel(entry.guests)}</span>
      <span className="admin-muted shrink-0">
        {fits ? partySizeLabel(entry.partySize) : "No cabe"}
      </span>
      <Button
        type="submit"
        name="replacementEntryId"
        value={entry.id}
        variant="outline"
        size="sm"
        disabled={pending || !fits}
      >
        Agregar a la lista
      </Button>
    </li>
  );
}

export function QueueReplacementList({
  waiting,
  releasedSeats,
  onBack,
}: QueueReplacementListProps) {
  return (
    <div className="grid gap-3">
      <ul aria-label="Cola" className="max-h-64 divide-y divide-border overflow-y-auto">
        {waiting.map((entry) => (
          <QueueEntryRow key={entry.id} entry={entry} releasedSeats={releasedSeats} />
        ))}
      </ul>
      <Button type="button" variant="ghost" className="w-full sm:w-fit" onClick={onBack}>
        Volver
      </Button>
    </div>
  );
}
