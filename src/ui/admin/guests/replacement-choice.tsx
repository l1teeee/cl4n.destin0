import type {
  PromotionPreviewEntry,
  WaitingQueueEntry,
} from "@/infrastructure/db/repositories/event-guest-queries";
import { cn } from "@/ui/cn";

import { guestsLabel, partySizeLabel } from "./guest-copy";

export type ReplacementMode = "auto" | "chosen";

interface ReplacementChoiceProps {
  mode: ReplacementMode;
  onModeChange: (mode: ReplacementMode) => void;
  entryId: string | null;
  onEntryChange: (entryId: string) => void;
  autoEntries: readonly PromotionPreviewEntry[];
  waiting: readonly WaitingQueueEntry[];
  releasedSeats: number;
}

const rowClassName = "flex min-h-11 items-center gap-3 rounded-md px-2 text-sm";

function autoNamesLabel(entries: readonly PromotionPreviewEntry[]): string {
  return entries.map((entry) => guestsLabel(entry.guests)).join(", ");
}

function QueueEntryRadio({
  entry,
  checked,
  enabled,
  releasedSeats,
  onSelect,
}: {
  entry: WaitingQueueEntry;
  checked: boolean;
  enabled: boolean;
  releasedSeats: number;
  onSelect: () => void;
}) {
  const fits = entry.partySize <= releasedSeats;

  return (
    <label className={cn(rowClassName, fits ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
      <input
        type="radio"
        name="replacementEntryId"
        value={entry.id}
        checked={checked}
        disabled={!enabled || !fits}
        onChange={onSelect}
        className="size-4 shrink-0 accent-current"
      />
      <span className="admin-muted w-8 shrink-0 font-mono">#{entry.position}</span>
      <span className="min-w-0 flex-1 break-words">{guestsLabel(entry.guests)}</span>
      <span className="admin-muted shrink-0">
        {fits ? partySizeLabel(entry.partySize) : "No cabe"}
      </span>
    </label>
  );
}

export function ReplacementChoice({
  mode,
  onModeChange,
  entryId,
  onEntryChange,
  autoEntries,
  waiting,
  releasedSeats,
}: ReplacementChoiceProps) {
  if (waiting.length === 0) {
    return <p className="admin-muted text-sm">No hay nadie en la cola.</p>;
  }

  const choosing = mode === "chosen";
  const autoNames = autoNamesLabel(autoEntries);

  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-medium">¿Quién entra en su lugar?</legend>
      <label className={cn(rowClassName, "cursor-pointer")}>
        <input
          type="radio"
          name="replacementMode"
          value="auto"
          checked={!choosing}
          onChange={() => onModeChange("auto")}
          className="size-4 shrink-0 accent-current"
        />
        <span className="min-w-0 flex-1">
          El primero de la cola
          {autoNames ? <span className="admin-muted block break-words">{autoNames}</span> : null}
        </span>
      </label>
      <label className={cn(rowClassName, "cursor-pointer")}>
        <input
          type="radio"
          name="replacementMode"
          value="chosen"
          checked={choosing}
          onChange={() => onModeChange("chosen")}
          className="size-4 shrink-0 accent-current"
        />
        Elegir de la cola
      </label>
      <div
        inert={!choosing}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          choosing ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div role="radiogroup" aria-label="Cola" className="max-h-64 overflow-y-auto pl-6">
            {waiting.map((entry) => (
              <QueueEntryRadio
                key={entry.id}
                entry={entry}
                checked={entryId === entry.id}
                enabled={choosing}
                releasedSeats={releasedSeats}
                onSelect={() => onEntryChange(entry.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
