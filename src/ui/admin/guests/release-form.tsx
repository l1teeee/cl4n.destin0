"use client";

import { useState, type ReactNode } from "react";

import type {
  PromotionPreviewEntry,
  WaitingQueueEntry,
} from "@/infrastructure/db/repositories/event-guest-queries";
import { MutationForm, type MutationAction } from "@/ui/admin/mutation-form";

import { ExpectedReplacementInputs } from "./expected-replacement-inputs";
import {
  cancelPaidConfirmation,
  cancelUnpaidConfirmation,
  guestsLabel,
  rejectConfirmation,
} from "./guest-copy";
import { ReplacementChoice, type ReplacementMode } from "./replacement-choice";

export type ReleaseKind = "REJECT" | "CANCEL_UNPAID" | "CANCEL_PAID";

interface ReleaseFormProps {
  action: MutationAction;
  label: string;
  kind: ReleaseKind;
  guests: readonly string[];
  waitingCount: number;
  autoEntries: readonly PromotionPreviewEntry[];
  waiting: readonly WaitingQueueEntry[];
  children?: ReactNode;
}

const confirmationByKind = {
  REJECT: rejectConfirmation,
  CANCEL_UNPAID: cancelUnpaidConfirmation,
  CANCEL_PAID: cancelPaidConfirmation,
} satisfies Record<ReleaseKind, typeof rejectConfirmation>;

// Rejecting or cancelling frees the seats of the released request; the admin either lets the
// first of the cola come in or picks who takes them.
export function ReleaseForm({
  action,
  label,
  kind,
  guests,
  waitingCount,
  autoEntries,
  waiting,
  children,
}: ReleaseFormProps) {
  const [mode, setMode] = useState<ReplacementMode>("auto");
  const [entryId, setEntryId] = useState<string | null>(null);

  const chosenEntry = waiting.find((entry) => entry.id === entryId);
  const replacements =
    mode === "chosen" && chosenEntry
      ? [guestsLabel(chosenEntry.guests)]
      : autoEntries.map((entry) => guestsLabel(entry.guests));

  return (
    <MutationForm
      action={action}
      label={label}
      confirmation={confirmationByKind[kind]({ guests, replacements, waitingCount })}
      danger
      reportToSection
      submitDisabled={mode === "chosen" && chosenEntry === undefined}
    >
      <ReplacementChoice
        mode={mode}
        onModeChange={setMode}
        entryId={entryId}
        onEntryChange={setEntryId}
        autoEntries={autoEntries}
        waiting={waiting}
        releasedSeats={guests.length}
      />
      {mode === "auto" ? (
        <ExpectedReplacementInputs entryIds={autoEntries.map((entry) => entry.id)} />
      ) : null}
      {children}
    </MutationForm>
  );
}
